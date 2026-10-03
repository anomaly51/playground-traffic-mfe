const webpack = require("webpack");
const { merge } = require("webpack-merge");
const singleSpaDefaults = require("webpack-config-single-spa-react-ts");

module.exports = (webpackConfigEnv = {}, argv = {}) => {
  const defaultConfig = singleSpaDefaults({
    orgName: "lab",
    projectName: "traffic-mfe",
    webpackConfigEnv,
    argv,
    outputSystemJS: true,
    disableHtmlGeneration: true,
  });

  return merge(defaultConfig, {
    devServer: {
      host: "0.0.0.0",
      port: 5175,
      allowedHosts: "all",
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    },
    plugins: [
      new webpack.DefinePlugin({
        __API_BASE_URL__: JSON.stringify(
          process.env.VITE_API_BASE_URL || "http://localhost:3000",
        ),
        __EVENTS_BASE_URL__: JSON.stringify(
          process.env.VITE_EVENTS_BASE_URL || "http://localhost:3003",
        ),
      }),
    ],
  });
};
