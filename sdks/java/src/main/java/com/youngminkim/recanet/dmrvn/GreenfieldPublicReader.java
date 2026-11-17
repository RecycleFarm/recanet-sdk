package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.*;

/** Fetches publicly readable Greenfield objects directly from a configured Storage Provider. */
public final class GreenfieldPublicReader implements DmrvnReader.ReportReader {
    private final URI endpoint;
    private final String chainId;
    private final HttpClient http;

    public GreenfieldPublicReader(URI endpoint, String chainId) {
        DmrvnConfig.checkUri(endpoint);
        require(endpoint.getQuery() == null, Code.INVALID_INPUT);
        this.endpoint = endpoint;
        this.chainId = chainId;
        http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    private static String encode(String text) {
        return URLEncoder.encode(text, StandardCharsets.UTF_8).replace("+", "%20");
    }

    @Override
    public byte[] read(Map<String, Object> location) {
        require(
                chainId.equals(location.get("chainId"))
                        && "1".equals(String.valueOf(location.get("storageType"))),
                Code.WRONG_CHAIN);
        String bucket = Json.str(location.get("bucketName")),
                object = Json.str(location.get("objectName"));
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
            if (response.statusCode() == 401 || response.statusCode() == 403)
                throw new DmrvnException(Code.STORAGE_ACCESS_DENIED);
            require(response.statusCode() == 200, Code.STORAGE_UNAVAILABLE);
            return response.body();
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new DmrvnException(Code.INTERRUPTED);
        } catch (DmrvnException e) {
            throw e;
        } catch (Exception e) {
            future.cancel(true);
            throw new DmrvnException(Code.STORAGE_UNAVAILABLE);
        }
    }
}
