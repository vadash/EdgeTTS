import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default (_env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: './src/index.tsx',

    output: {
      path: isProduction
        ? path.resolve(__dirname, 'dist', 'latest')
        : path.resolve(__dirname, 'dist'),
      filename: isProduction ? '[name].[contenthash].js' : '[name].js',
      publicPath: isProduction ? './' : '/',
    },

    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      alias: {
        react: 'preact/compat',
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
            'postcss-loader',
          ],
        },
        {
          test: /\.(png|svg|jpg|jpeg|gif)$/i,
          type: 'asset/resource',
        },
      ],
    },

    plugins: [
      new CleanWebpackPlugin({
        // Only clean the specific version subfolder, not entire dist
        cleanOnceBeforeBuildPatterns: ['**/*'],
      }),
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
          { from: 'public/*.md', to: '[name][ext]' },
          // Copy 404.html to dist root for GitHub Pages (one level up from dist/latest/)
          ...(isProduction ? [{ from: 'public/404.html', to: '../404.html' }] : []),
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
