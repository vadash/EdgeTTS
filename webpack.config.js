const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: './src/index.tsx',

    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProduction ? '[name].[contenthash].js' : '[name].js',
      publicPath: isProduction ? '/EdgeTTS/' : '/',
    },

    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      alias: {
        'react': 'preact/compat',
        'react-dom': 'preact/compat',
        '@': path.resolve(__dirname, 'src'),
      },
    },

    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
          ],
        },
        {
          test: /\.(png|svg|jpg|jpeg|gif)$/i,
          type: 'asset/resource',
        },
      ],
    },

    plugins: [
      new CleanWebpackPlugin(),
      new HtmlWebpackPlugin({
        template: './public/index.html',
        favicon: './public/logo.png',
      }),
      new MiniCssExtractPlugin({
        filename: isProduction ? '[name].[contenthash].css' : '[name].css',
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: 'public/RU.lexx', to: 'RU.lexx' },
        ],
      }),
    ],

    devServer: {
      static: './dist',
      hot: true,
      port: 3000,
      open: true,
    },

    devtool: isProduction ? 'source-map' : 'eval-source-map',

    // Suppress FFmpeg dynamic import warnings (expected behavior)
    ignoreWarnings: [
      {
        module: /@ffmpeg[\\/]ffmpeg[\\/]dist[\\/]esm/,
        message: /Critical dependency/,
      },
    ],

    optimization: {
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
          },
        },
      },
    },
  };
};
