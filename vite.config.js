import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    open: true,
    port: 8080, //启动端口
    hmr: {
        host: '127.0.0.1',
        port: 8080
    }
  }
})
