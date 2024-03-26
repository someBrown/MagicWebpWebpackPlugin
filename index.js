const fs = require("fs");
const sharp = require("sharp");
const crypto = require("crypto");

function promisify(fn) {
  return function () {
    const args = Array.prototype.slice.call(arguments);
    return new Promise((resolve, reject) => {
      fn.apply(
        this,
        [].concat(args).concat([
          (err, res) => {
            if (err !== null) {
              return reject(err);
            }
            resolve(res);
          },
        ])
      );
    });
  };
}

const pluginName = "MagicWebpWebpackPlugin";

function getContnetHash(buffer, length) {
  // blake2s256 是 crypto 库支持的算法中最快的
  const hash = crypto.createHash("blake2s256");
  hash.update(buffer, "utf8");
  const md5 = hash.digest("hex");
  return md5.slice(0, length);
}

function addHashToPath(path, hash) {
  const index = path.lastIndexOf(".");
  return `${path.slice(0, index)}.${hash}${path.slice(index)}`;
}

function clearExt(path) {
  const index = path.lastIndexOf(".");
  return path.slice(0, index);
}

function getExt(path) {
  const index = path.lastIndexOf(".");
  return path.slice(index);
}

async function resolvePaths(resolver, context, request, supportExt) {
  const requestWithoutExt = request.replace(/\.webp$/, "");
  const customResolver = resolver.withOptions({
    extensions: supportExt,
  });
  const matchedPath = await new Promise((resolve, reject) => {
    customResolver.resolve(
      {},
      context,
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
  const virtualWebpPath = clearExt(matchedPath) + ".webp";
  return {
    matchedPath,
    virtualWebpPath,
  };
}

function getMathedRequest(request, matchedExt) {
  return request.replace(/\.webp$/, matchedExt);
}

function getNextRequest(request, matchedHash) {
  return addHashToPath(request, matchedHash);
}

const defaultOptions = {
  supportExt: [".png", ".jpg", ".jpeg"],
  hashLength: 6,
  webpOptions: {
    quality: 80,
  },
};

module.exports = class MagicWebpWebpackPlugin {
  constructor(options = {}) {
    this.options = {
      ...defaultOptions,
      ...options,
    };
  }
  apply(compiler) {
    compiler.hooks.normalModuleFactory.tap(
      pluginName,
      (normalModuleFactory) => {
        normalModuleFactory.hooks.beforeResolve.tapPromise(
          pluginName,
          async (data) => {
            if (/\.webp$/.test(data.request)) {
              const { supportExt, hashLength, webpOptions } = this.options;
              // '@/img/xxx' 需要用到 resolver
              const resolver = normalModuleFactory.getResolver("normal");
              const { matchedPath, virtualWebpPath } = await resolvePaths(
                resolver,
                data.context,
                data.request,
                supportExt
              );
              // 不带 hash的 webp 不是本插件转换的 webp 说明本地已经有了 webp文件 直接跳过
              const maybeExists = fs.existsSync(virtualWebpPath);
              if (maybeExists) {
                return;
              }
              const matchedImg = await promisify(fs.readFile)(matchedPath);
              const matchedExt = getExt(matchedPath);
              // base64 逻辑处理
              const assetsOptions = compiler.options.module.rules.find(
                (rule) => rule.type === "asset"
              );
              const dataUrlCondition =
                assetsOptions?.parser?.dataUrlCondition?.maxSize || 8 * 1024;
              // 如果图片小于 base64 的界限，就不转换了，但是需要把这个 webp 重定向回 supportExt
              if (matchedImg.length < dataUrlCondition) {
                data.request = getMathedRequest(data.request, matchedExt);
                return;
              }
              const matchedHash = getContnetHash(matchedImg, hashLength);
              const virtualHashWebpPath = addHashToPath(
                virtualWebpPath,
                matchedHash
              );
              const isExists = fs.existsSync(virtualHashWebpPath);
              if (isExists) {
                data.request = getNextRequest(data.request, matchedHash);
                return;
              }
              const webpBuffer = await sharp(matchedImg)
                .webp(webpOptions)
                .toBuffer();

              // 新图和旧图大小对比
              if (matchedImg.length < webpBuffer.length) {
                data.request = getMathedRequest(data.request, matchedExt);
                return;
              }
              await promisify(fs.writeFile)(virtualHashWebpPath, webpBuffer);
              data.request = getNextRequest(data.request, matchedHash);
            }
          }
        );
      }
    );
  }
};
