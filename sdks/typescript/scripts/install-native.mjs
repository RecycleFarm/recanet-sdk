// npm os/cpu fields allow a cross product; keep installation to the tested pairs.
if (!((process.platform === 'linux' && process.arch === 'x64') ||
      (process.platform === 'darwin' && process.arch === 'arm64'))) {
  throw new Error(`Recanet SDK supports linux/x64 and darwin/arm64; received ${process.platform}/${process.arch}`);
}
// Native binaries are bundled in prebuilds; installation never compiles or downloads them.
