const path = require("path");
const webpack = require("webpack");
const MagicWebpWebpackPlugin = require("../index.js");

const compiler = (entry) => {
  const compiler = webpack({
    context: __dirname,
    // mode: "development",
    entry,
    output: {
      path: path.resolve(`${__dirname}/dist`),
      filename: "bundle.js",
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    module: {
      rules: [
        {
          test: /\.(png|jpe?g|gif|webp)(\?.*)?$/i,
          type: "asset",
          // parser: {
          //   dataUrlCondition: {
          //     maxSize: 8 * 1024,
          //   },
          // },
        },
      ],
    },
    plugins: [
      new MagicWebpWebpackPlugin({
        webpOptions: {
          quality: 70,
        },
      }),
    ],
  });

  return new Promise((resolve, reject) => {
    compiler.run((err, stats) => {
      console.log(err);
      if (err) reject(err);
      if (stats.hasErrors()) reject(stats.toJson().errors);
      resolve(stats);
    });
  });
};

compiler("./src/index.js").catch(console.log);
