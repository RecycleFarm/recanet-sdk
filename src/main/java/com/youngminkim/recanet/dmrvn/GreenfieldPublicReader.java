package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.*;
import com.youngminkim.recanet.telemetry.SdkTelemetry;

/** Fetches publicly readable Greenfield objects directly from a configured Storage Provider. */
public final class GreenfieldPublicReader implements DmrvnReader.ReportReader {
    private final URI endpoint;
    private final String chainId;
    private final HttpClient http;
    private final SdkTelemetry telemetry;

    public GreenfieldPublicReader(URI endpoint, String chainId) {
        this(endpoint, chainId, SdkTelemetry.local());
    }

    public GreenfieldPublicReader(URI endpoint, String chainId, SdkTelemetry telemetry) {
        this.telemetry = java.util.Objects.requireNonNull(telemetry);
        DmrvnConfig.checkUri(endpoint);
        require(endpoint.getQuery() == null, Code.INVALID_INPUT,
                "endpoint", "must not contain a query string");
        this.endpoint = endpoint;
        this.chainId = chainId;
        http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    private static String encode(String text) {
        return URLEncoder.encode(text, StandardCharsets.UTF_8).replace("+", "%20");
    }

    @Override
    public byte[] read(Map<String, Object> location) {
        return telemetry.step("GreenfieldPublicReader.read", () -> readImpl(location));
    }

    private byte[] readImpl(Map<String, Object> location) {
        require(
                chainId.equals(location.get("chainId"))
                        && "1".equals(String.valueOf(location.get("storageType"))),
                Code.WRONG_CHAIN);
        String bucket = Json.str(location.get("bucketName"), "bucketName"),
                object = Json.str(location.get("objectName"), "objectName");
        String base = endpoint.toString().replaceAll("/+$", "");
        var uri =
                URI.create(
                        base
                                + "/"
                                + encode(bucket)
                                + "/"
                                + java.util.Arrays.stream(object.split("/", -1))
                                        .map(GreenfieldPublicReader::encode)
                                        .collect(java.util.stream.Collectors.joining("/")));
        var request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(30)).GET().build();
        var future =
                http.sendAsync(request, ignored -> new HttpEvmRpc.BoundedBody(4 * 1024 * 1024));
        try {
            var response = future.get(30, TimeUnit.SECONDS);
            if (response.statusCode() != 200) {
                String body = new String(response.body(), StandardCharsets.UTF_8);
                throw new UpstreamException(UpstreamException.Source.GREENFIELD, null,
                        response.statusCode(), body, body);
            }
            return response.body();
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw UpstreamException.transport(UpstreamException.Source.GREENFIELD, e);
        } catch (UpstreamException e) {
            throw e;
        } catch (DmrvnException e) {
            throw e;
        } catch (Exception e) {
            future.cancel(true);
            throw UpstreamException.transport(UpstreamException.Source.GREENFIELD, e);
        }
    }
}
