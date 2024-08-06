/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: false,
    webpack: (config) => {
        config.module.rules.unshift({
            test: /\.worker\.ts$/,
            loader: 'worker-loader',
        });
        return config;
    },
};

export default nextConfig;
