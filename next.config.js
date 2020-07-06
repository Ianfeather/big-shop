const withSourceMaps = require('@zeit/next-source-maps')

module.exports = withSourceMaps({
  target: 'serverless',
  cssModules: true
});
