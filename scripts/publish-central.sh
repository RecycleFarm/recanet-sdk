#!/usr/bin/env bash
set -euo pipefail

cd "${1:?Usage: publish-central.sh STAGED_RELEASE_DIRECTORY}"
sha256sum -c SHA256SUMS
jq -e '.language == "java" and .publishReady and .sourceJarIncluded' manifest.json >/dev/null
group=$(jq -er '.package.groupId' manifest.json)
artifact=$(jq -er '.package.artifactId' manifest.json)
version=$(jq -er '.version' manifest.json)
layout="${group//./\/}/$artifact/$version"
jar="$artifact-$version.jar"

temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
status=$(curl -sS --max-time 30 -o "$temp/published.jar" -w '%{http_code}' \
  "https://repo.maven.apache.org/maven2/$layout/$jar")
case "$status" in
  200)
    cmp "maven/$layout/$jar" "$temp/published.jar"
    echo "Maven Central already has the staged JAR for $group:$artifact:$version."
    exit 0 ;;
  404) ;;
  *) echo "Maven Central lookup returned HTTP $status" >&2; exit 1 ;;
esac

: "${CENTRAL_USERNAME:?Missing Central Portal token username}"
: "${CENTRAL_PASSWORD:?Missing Central Portal token password}"
: "${CENTRAL_GPG_PRIVATE_KEY:?Missing ASCII-armored GPG private key}"
export GNUPGHOME="$temp/gnupg"
mkdir -m 700 "$GNUPGHOME"
printf '%s\n' "$CENTRAL_GPG_PRIVATE_KEY" | gpg --batch --import
unset CENTRAL_GPG_PRIVATE_KEY

cp -R maven "$temp/maven"
cd "$temp/maven"
for file in "$layout/"*; do
  printf '%s\n' "${CENTRAL_GPG_PASSPHRASE-}" | gpg --batch --armor --detach-sign \
    --pinentry-mode loopback --passphrase-fd 0 "$file"
  for algorithm in md5 sha1 sha256 sha512; do
    "${algorithm}sum" "$file" | cut -d ' ' -f 1 > "$file.$algorithm"
  done
done
unset CENTRAL_GPG_PASSPHRASE
zip -qr "$temp/central-bundle.zip" "$layout"

authorization=$(printf '%s:%s' "$CENTRAL_USERNAME" "$CENTRAL_PASSWORD" | openssl base64 -A)
unset CENTRAL_USERNAME CENTRAL_PASSWORD
central_api() {
  printf 'header = "Authorization: Bearer %s"\n' "$authorization" |
    curl --disable --config - --silent --show-error --fail-with-body --max-time 120 "$@"
}

api=https://central.sonatype.com/api/v1/publisher
deployment=$(central_api --form "bundle=@$temp/central-bundle.zip;type=application/octet-stream" \
  "$api/upload?publishingType=AUTOMATIC")
echo "Central Portal deployment $deployment"
for ((attempt = 0; attempt < 30; attempt++)); do
  response=$(central_api --request POST "$api/status?id=$deployment")
  state=$(jq -er '.deploymentState' <<< "$response")
  echo "Central Portal status $state"
  case "$state" in
    PUBLISHED) exit 0 ;;
    FAILED) jq '.errors' <<< "$response" >&2; exit 1 ;;
    PENDING|VALIDATING|VALIDATED|PUBLISHING) sleep 20 ;;
    *) echo "Unexpected Central Portal state $state" >&2; exit 1 ;;
  esac
done
echo "Check deployment $deployment in Central Portal before retrying." >&2
exit 1
