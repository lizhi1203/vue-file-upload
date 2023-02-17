<script setup>
  import { ref,computed, onMounted } from 'vue';
  import { uploadFile, mergeChunks } from './request'
  import cloneDeep from 'lodash/cloneDeep'

  const currFile = ref({});
  let fileChunkList = ref([]);
  const DefaultChunkSize = 1 * 1024 * 1024;

  onMounted(() => {
    bindEvents();
  })

  const dragRef = ref();
  const bindEvents = () => {
    const drag = dragRef.value;
    drag.addEventListener('dragover', (e) => {
      drag.style.borderColor = 'red'
      e.preventDefault()
    })
    drag.addEventListener('dragleave', (e) => {
      drag.style.borderColor = '#eee'
      e.preventDefault()
    })
    drag.addEventListener('drop', (e) => {
      const [file] = e.dataTransfer.files;
      drag.style.borderColor = 'red';
      processFile(file);
      e.preventDefault()
    })
  }

  const fileChangeHandle = async(event) => {
    const [file] = event.target.files;
    if (!file) return;
    processFile(file);
  }

  const processFile = async(file) => {
    if (!file) return;

    currFile.value = file;
    fileChunkList.value = [];
    const { filehash } = await getFileChunk(file);
    uploadChunk(filehash)
  }
  const getFileChunk1 = (file, chunkSize = DefaultChunkSize) => {
    return new Promise((resolve) => {
      let currChunk = 0,
        chunkCount = Math.ceil(file.size / chunkSize),
        spark = new sparkMD5.ArrayBuffer();

      let workLoop = deadline => {

      }
    })
  }

  // 获取资源分块
  const getFileChunk = (file, chunkSize = DefaultChunkSize) => {
    return new Promise((resolve) => {
      let currChunk = 0,
        chunkCount = Math.ceil(file.size / chunkSize);
      while (currChunk < chunkCount) {
        let start = currChunk * chunkSize,
          end = ((start + chunkSize) >= file.size) ? file.size : start + chunkSize;
        fileChunkList.value.push({ chunk: file.slice(start, end), size: end - start, name: file.name });
        currChunk++;
      }
      // 开启web worker计算hash值, 防止卡主线程
      let worker = new Worker('/worker/hashWorker.js');
      worker.postMessage({ fileChunkList: cloneDeep(fileChunkList.value) })
      worker.addEventListener('message', e => {
        resolve({ filehash:　e.data.filehash });
      })
    })
  }

  // 上传文件和发送合并请求
  const uploadChunk = (fileHash) => {
    const requests = fileChunkList.value.map((item, index) => {
      const formData = new FormData()
      formData.append(`${currFile.value.name}-${fileHash}-${index}`, item.chunk);
      formData.append('filename', currFile.value.name);
      formData.append('hash', `${fileHash}-${index}`);
      formData.append('fileHash', fileHash);
      return uploadFile('/upload', formData, onUploadProgress(item));
    })
    Promise.all(requests).then(() => {
      mergeChunks('/mergeChunks', { size: DefaultChunkSize, filename: currFile.value.name });
    });
  };

  const totalPercentage = computed(() => {
    if (!fileChunkList.value.length) return;
    const loaded = fileChunkList.value
      .map(item => item.size * item.percentage)
      .reduce((curr, next) => curr + next);
    return parseInt((loaded / currFile.value.size).toFixed(2));
  });

  const onUploadProgress = (item) => e => {
    item.percentage = parseInt(String((e.loaded / e.total) * 100));
  };

</script>

<template>
  <h1>大文件分片上传</h1>
  <div id="drag" ref="dragRef">
    <input type="file" @change="fileChangeHandle" />
  </div>

  <h2>总进度 {{totalPercentage || 0}}%</h2>
  <div class="percentage total">
    <p class="bg" :style="`width: ${totalPercentage || 0}%`"></p>
  </div>

  <div class="progress" v-if="fileChunkList.length">
    <div class="progress-chunk" v-for="(item, index) in fileChunkList" :key="index">
      <div class="clonm flex-1">{{item.name}}_{{index}}</div>
      <div class="clonm size">{{item.size}}kb</div>
      <div class="clonm flex-1">
        <div class="percentage">
          <p class="bg" :style="`width: ${item.percentage || 0}%`"></p>
        </div>
        <span class="text">{{item.percentage || 0}}%</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
* {
  margin: 0;
  padding: 0;
}
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
}
h1,
h2 {
  margin: 20px;
  width: 90%;
}
#drag {
  height: 100px;
  line-height: 100px;
  border: 2px dashed #eee;
  text-align: center;
  vertical-align: middle;
}
.total {
  width: 91%;
  margin: auto;
}
.progress {
  width: 90%;
  margin: 20px auto;
  border: 1px solid #0677e9;
  padding: 10px;
}
.progress-chunk {
  display: flex;
  padding: 10px 0;
  border-bottom: 1px solid #c5d1dd;
}
.clonm {
  display: flex;
  align-items: center;
  word-break: break-word;
  text-align: center;
}
.size {
  width: 200px;
}
.flex-1 {
  flex: 1;
}
.percentage {
  flex: 1;
  background-color: #bdc1c5;
  border-radius: 3px;
  height: 6px;
  display: flex;
  align-items: center;
}
.bg {
  height: 100%;
  width: 0%;
  border-radius: 3px;
  background: rgb(22, 245, 2);
}
.text {
  width: 45px;
  padding: 0 5px;
}
</style>
