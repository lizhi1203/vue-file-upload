import axios from 'axios'
const request = axios.create({
  baseURL: "http://localhost:3000/upload",
  timeout: 10000,
});

/**
 *  检查文件是否已存在
 * @param {*} url 
 * @param {*} fileName 
 * @param {*} fileMd5 
 */
export function checkFileExist(url, fileName, fileMd5) {
  return request.get(url, {
      params: {
        fileName,
        fileMd5
      },
    // 返回data数据层
    }).then((response) => response.data);
}

/**
 * 上传文件
 * @param {*} url 
 * @param {*} formData 
 * @param {*} onUploadProgress 回调，用于每个分块制作上传进度条
 */
export const uploadFile = (url, formData, onUploadProgress = () => {}) => {
  return request.post(url, formData, {
      headers: {
        "Content-Type": "multipart/form-data"
      },
      onUploadProgress
    }
  )
}

/**
 * 合并请求
 * @param {*} url 
 * @param {*} param1 
 */
export const mergeChunks = (url, { fileName, fileMd5 }) => {
  return request.get(url, {
    params: {
      fileName,
      fileMd5,
    }
  });
}