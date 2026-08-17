module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Must stay last: worklets plugin rewrites Reanimated/Skia UI-thread functions.
    plugins: ['react-native-worklets/plugin'],
  };
};
