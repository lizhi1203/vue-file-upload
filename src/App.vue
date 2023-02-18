<script setup>
  import { ref,computed, onMounted } from 'vue';
  import { uploadFile, mergeChunks } from './request'
  import SparkMD5 from 'spark-md5'
  import cloneDeep from 'lodash/cloneDeep'

  const currFile = ref({});
  let fileChunkList = ref([]);
  const DefaultChunkSize = 5 * 1024 * 1024;

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
    fileChunkList.value = createFileChunk(file)
    // 方法1: 普通方式计算hash
    // const { filehash } = await calculateHashSample();
    // 方法2：布隆过滤器抽样hash计算md5
    const { filehash } = await calculateHashBloomFilter();
    // 方法3: webworker
    // const { filehash } = await calculateHashWorker();
    // 方法4: requestIdleCallback
    // const { filehash } = await calculateHashIdle();
    uploadChunk(filehash)
  }

  // 获取资源分块
  const createFileChunk = (file, chunkSize = DefaultChunkSize) => {
    let chunks = [],
        currChunk = 0,
        chunkCount = Math.ceil(file.size / chunkSize);
      while (currChunk < chunkCount) {
        let start = currChunk * chunkSize,
          end = ((start + chunkSize) >= file.size) ? file.size : start + chunkSize;
        chunks.push({ chunk: file.slice(start, end), size: end - start, name: file.name });
        currChunk++;
      }
      return chunks;
  }

  const calculateHashSample = () => {
    return new Promise((resolve) => {
      let fileReader = new FileReader(),
        spark = new SparkMD5.ArrayBuffer(),
        currChunk = 0,
        chunkCount = fileChunkList.value.length;
      
      fileReader.onload = e => {
        const chunk = e.target.result;
        spark.append(chunk);
        currChunk++;

        if (currChunk < chunkCount) {
          loadNext(currChunk)
        } else {
          resolve({ filehash: spark.end() })
        }
      }

      fileReader.onerror = () => {
        console.warn('oops, something went wrong.');
      }

      const loadNext = (index) => {
        const chunk = fileChunkList.value[index].chunk
        fileReader.readAsArrayBuffer(chunk)
      }
      loadNext(0)
    })
  }

  // 抽样hash计算md5,不算全量.
  // 布隆过滤器:损失一部分的精度,换取效率.
  const calculateHashBloomFilter = () => {
    return new Promise((resolve) => {
      let fileReader = new FileReader(),
        spark = new SparkMD5.ArrayBuffer(),
        file = currFile.value,
        size = currFile.value.size,
        offset = 2 * 1024 * 1024,
        // 第1个2M，最后一个区块数据全要
        chunks = [file.slice(0, offset)],
        cur = offset;
      
      while (cur < size) {
        // 最后一个区块数据全要
        if (cur + offset >= size) {
          chunks.push(file.slice(cur, cur + offset));
        } else {
          // 中间区块，取前中后各2个字节
          const mid = (cur + offset) / 2;
          const end = cur + offset;
          chunks.push(file.slice(cur, cur + 2));
          chunks.push(file.slice(mid, mid + 2));
          chunks.push(file.slice(end - 2, end));
        }
        cur += offset;
      }

      fileReader.readAsArrayBuffer(new Blob(chunks));
      fileReader.onload = e => {
        spark.append(e.target.result);
        resolve({ filehash: spark.end() });
      }
    })
  };

  // 开启web worker计算hash值, 防止卡主线程
  const calculateHashWorker = () => {
    return new Promise((resolve) => {
      // webWorker是要另外加载一个js文件, vite只能读取public\worker下面的worker.js文件
      // 开启一个子线程或者隐分身
      let worker = new Worker('/worker/hashWorker.js');
      // 向worker的内部作用域发送一个消息
      // 不能操作DOM、作用域要独立，所以cloneDeep克隆一份
      worker.postMessage({ fileChunkList: cloneDeep(fileChunkList.value) })
      // Worker子线程返回一条消息时被调用
      worker.addEventListener('message', e => {
        resolve({ filehash:　e.data.filehash });
      })
    })
  }

  // 利用浏览器时间碎片(空闲时间)计算hash值，防止卡主线程
  const calculateHashIdle = () => {
    return new Promise((resolve) => {
      let currChunk = 0,
        chunkCount = fileChunkList.value.length,
        spark = new SparkMD5.ArrayBuffer();
      
      const appendToSpark = chunk => {
        return new Promise(resolve => {
          const fileReader = new FileReader();
          fileReader.readAsArrayBuffer(chunk);
          fileReader.onload = e => {
            spark.append(e.target.result);
            resolve();
          }
        })
      };

      const workLoop = async deadline => {
        // 有任务且有空闲时间(当前帧剩余的毫秒大于0)
        while (currChunk < chunkCount && deadline.timeRemaining() > 0) {
          await appendToSpark(fileChunkList.value[currChunk].chunk);
          currChunk++;
          if (currChunk === chunkCount) {
            resolve(spark.end())
          }
        }
        // 当前浏览器处于空闲状态，才回调执行
        window.requestIdleCallback(workLoop);
      };
      // 当前浏览器处于空闲状态，才回调执行
      window.requestIdleCallback(workLoop);
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
    if (!fileChunkList.value.length) return 0;
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
