const fs = require("fs");
const sharp = require("sharp");
const crypto = require("crypto");
const { promisify } = require("util");

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

const pluginName = "MagicWebpWebpackPlugin";

class MagicWebpWebpackPlugin {
  constructor(options = {}) {
    this.options = {
      supportExt: [".png", ".jpg", ".jpeg"],
      hashLength: 6,
      webpOptions: { quality: 80 },
      ...options,
    };
  }
  apply(compiler) {
    compiler.hooks.normalModuleFactory.tap(
      pluginName,
      (normalModuleFactory) => {
        normalModuleFactory.hooks.beforeResolve.tapPromise(
          pluginName,
          async (module) => {
            if (/\.webp$/.test(module.request)) {
              try {
                await this.handleBeforeResolve({
                  module,
                  normalModuleFactory,
                  compiler,
                });
              } catch (e) {
                console.error(e);
              }
            }
          }
        );
      }
    );
  }

  async handleBeforeResolve({ module, normalModuleFactory, compiler }) {
    const { matchedPath, virtualWebpPath } = await this.resolvePaths({
      normalModuleFactory,
      module,
    });

    if (this.fileExists(virtualWebpPath) || !this.fileExists(matchedPath)) {
      return;
    }

    const matchedImg = await readFileAsync(matchedPath);
    const matchedExt = this.getExtension(matchedPath);
    const matchedRequest = this.replaceExtension(module.request, matchedExt);

    if (this.isBelowBase64Threshold({ buffer: matchedImg, compiler })) {
      module.request = matchedRequest;
      return;
    }

    const matchedHash = this.getHash(matchedImg);
    const virtualHashWebpPath = this.addHashToPath(
      virtualWebpPath,
      matchedHash
    );

    const rewrittenRequest = this.addHashToPath(module.request, matchedHash);

    if (this.fileExists(virtualHashWebpPath)) {
      module.request = rewrittenRequest;
      return;
    }
    const webpBuffer = await this.convertToWebp(matchedImg);

    if (this.isOriginalSmaller(matchedImg, webpBuffer)) {
      module.request = matchedRequest;
      return;
    }

    if (this.isDevelopment()) {
      this.cleanOldWebpFiles(matchedPath);
    }

    await writeFileAsync(virtualHashWebpPath, webpBuffer);
    module.request = rewrittenRequest;
  }

  async resolvePaths({ normalModuleFactory, module }) {
    const { supportExt } = this.options;

    const { context: moduleContext, request } = module;
    const resolver = normalModuleFactory.getResolver("normal");

    const requestWithoutExt = this.removeExtension(request);

    const customResolver = resolver.withOptions({ extensions: supportExt });

    const matchedPath = await new Promise((resolve, reject) => {
      customResolver.resolve(
        {},
        moduleContext,
        requestWithoutExt,
        {},
        (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        }
      );
    });

    return {
      matchedPath,
      virtualWebpPath: `${this.removeExtension(matchedPath)}.webp`,
    };
  }

  getHash(buffer) {
    const { hashLength } = this.options;
    const hash = crypto.createHash("blake2s256");
    hash.update(buffer);
    return hash.digest("hex").slice(0, hashLength);
  }

  addHashToPath(path, hash) {
    const index = path.lastIndexOf(".");
    return `${path.slice(0, index)}.${hash}${path.slice(index)}`;
  }

  removeExtension(path) {
    return path.slice(0, path.lastIndexOf("."));
  }

  getExtension(path) {
    return path.slice(path.lastIndexOf("."));
  }

  replaceExtension(request, extension) {
    return request.replace(/\.webp$/, extension);
  }

  fileExists(path) {
    return fs.existsSync(path);
  }

  isBelowBase64Threshold({ buffer, compiler }) {
    const assetsOptions = compiler.options.module.rules.find(
      (rule) => rule.type === "asset"
    );
    const maxSize =
      assetsOptions?.parser?.dataUrlCondition?.maxSize || 8 * 1024;
    return buffer.length < maxSize;
  }

  convertToWebp(buffer) {
    const { webpOptions } = this.options;
    return sharp(buffer).webp(webpOptions).toBuffer();
  }

  isOriginalSmaller(originalBuffer, webpBuffer) {
    return originalBuffer.length < webpBuffer.length;
  }

  isDevelopment() {
    return process.env.APP_ENV === "development";
  }

  cleanOldWebpFiles(matchedImgPath) {
    const { hashLength } = this.options;
    const dir = matchedImgPath.slice(0, matchedImgPath.lastIndexOf("/"));
    const name = matchedImgPath.slice(matchedImgPath.lastIndexOf("/") + 1);
    const regex = new RegExp(
      `^${this.removeExtension(name)}\\.[a-z0-9]{${hashLength}}\\.webp$`
    );
    fs.readdirSync(dir)
      .filter((file) => regex.test(file))
      .forEach((file) => fs.unlinkSync(`${dir}/${file}`));
  }
}

module.exports = MagicWebpWebpackPlugin;
