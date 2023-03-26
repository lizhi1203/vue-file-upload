<script setup>
  import { ref,computed, onMounted } from 'vue';
  import { uploadFile, mergeChunks, checkFileExist } from './request';
  import SparkMD5 from 'spark-md5';
  import cloneDeep from 'lodash/cloneDeep';

  const currFile = ref({});
  let fileChunkList = ref([]);
  const DefaultChunkSize = 3 * 1024 * 1024;

  onMounted(() => {
    bindEvents();
  })

  const dragRef = ref();
  const bindEvents = () => {
    const drag = dragRef.value;
    drag.addEventListener('dragover', (e) => {
      drag.style.borderColor = 'red';
      e.preventDefault();
    })
    drag.addEventListener('dragleave', (e) => {
      drag.style.borderColor = '#eee';
      e.preventDefault();
    })
    drag.addEventListener('drop', (e) => {
      const [file] = e.dataTransfer.files;
      drag.style.borderColor = 'red';
      processFile(file);
      e.preventDefault();
    })
  }

  const fileChangeHandle = async(event) => {
    const [file] = event.target.files;
    processFile(file);
  }

  const processFile = async(file) => {
    if (!file) return;

    // 校验图片格式，根据实际情况开放 
    // if (!await isImage(file)) {
    //   alert('文件格式不对，只能上传jpg, png, gif的图片格式!');
    //   return;
    // }

    // 1.获取待上传文件
    currFile.value = file;

    // 2.文件切片
    fileChunkList.value = createFileChunk(file);

    // 3.计算文件的MD5值
    // 方法1: 普通方式计算MD5
    // const { fileMd5 } = await calculateHashSample();
    // 方法2：布隆过滤器抽样hash计算MD5
    // const { fileMd5 } = await calculateHashBloomFilter();
    // 方法3: 多线程(webworker)计算MD5
    const { fileMd5 } = await calculateHashWorker();
    // 方法4: 时间碎片(requestIdleCallback)计算MD5
    // const { fileMd5 } = await calculateHashIdle();

    // 4.检查文件是否已存在
    const fileStatus = await checkFileExist("/exists", currFile.value.name, fileMd5);
    // 4.1.是，文件秒传，获取已上传文件的地址
    if (fileStatus.data && fileStatus.data.isExists) {
      alert("文件已上传[秒传]");
    // 4.2.否则返回已上传的分块ID列表，异步并发数量控制地进行上传或者续传，上传完成后发送合并请求
    } else {
      await uploadChunk({ fileMd5, chunkIds: fileStatus.data.chunkIds, poolLimit: 3 });
    }
  }

  /**
   * 二进制大对象转换成十六进制
   */
  const blobToString = (blob) => {
    return new Promise((resolve) => {
      const fileReader = new FileReader();
      fileReader.onload = function(e) {
        // blob大对象数据类型
        const ret = e.target.result.split('')
          // 返回指定位置的unicode编码
          .map(v => v.charCodeAt())
          // 转换为十六进制大写
          .map(v => v.toString(16).toUpperCase())
          // 不足两位补0
          .map(v => v.padStart(2, '0'))
          .join(' ');
        resolve(ret);
      }
      fileReader.readAsBinaryString(blob);
    })
  }
  const isGif = async(file) => {
    // GIF89a和GIF87a
    // blob数据是存储二进制大对象数据, 一般存放二进制的，所以才用字节存取。
    // 前面6个16进制'47 49 46 38 39 61'和'47 49 46 38 37 61'
    const ret = await blobToString(file.slice(0, 6))
    return (ret === '47 49 46 38 39 61') || (ret === '47 49 46 38 37 61')
  }

  const isPng = async(file) => {
    // file.slice:对文件进行分块
    const ret = await blobToString(file.slice(0, 8))
    return (ret  === '89 50 4E 47 0D 0A 1A 0A')
  }
  
  const isJpg = async(file) => {
    const len = file.size;
    const start = await blobToString(file.slice(0, 2));
    const tail = await blobToString(file.slice(-2, len));
    return (start == "FF D8" && tail == "FF D9");
  }

  /**
   * 是否图片(支持jpg, jpng, gif格式)
   */
  const isImage = async(file) => {
    return await isJpg(file) || await isPng(file) || await isGif(file);
  }

  /**
   * 获取资源分块
   * file: 文件
   * chunkSize：分块大小
   */
  const createFileChunk = (file, chunkSize = DefaultChunkSize) => {
    let chunks = [],
      currChunk = 0,
      // 分块数(向上取整)
      chunkCount = Math.ceil(file.size / chunkSize);
    while (currChunk < chunkCount) {
      let start = currChunk * chunkSize,
        end = ((start + chunkSize) >= file.size) ? file.size : start + chunkSize;
      chunks.push({ chunk: file.slice(start, end), size: end - start, name: file.name });
      currChunk++;
    }
    return chunks;
  }

  /**
   * fileReader与sparkMD5方法计算hash，缺点会卡主线程
   */
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
          resolve({ fileMd5: spark.end() })
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

  /**
   * 布隆过滤器计算md5值
   * 抽样hash、不算全量、损失一部分的精度换取效率。
   */
  const calculateHashBloomFilter = () => {
    return new Promise((resolve) => {
      let fileReader = new FileReader(),
        spark = new SparkMD5.ArrayBuffer(),
        file = currFile.value,
        size = currFile.value.size,
        offset = 2 * 1024 * 1024,
        // 1、第1个区块取2M
        chunks = [file.slice(0, offset)],
        cur = offset;
      
      while (cur < size) {
        // 3、最后一个区块数据全要
        if (cur + offset >= size) {
          chunks.push(file.slice(cur, cur + offset));
        } else {
          // 2、中间每个区块，取前中后各2个字节
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
        resolve({ fileMd5: spark.end() });
      }
    })
  };

  /**
   * 开启web worker计算hash值, 防止卡主线程
   */
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
        resolve({ fileMd5:　e.data.fileMd5 });
      })
    })
  }
  
  /**
   * 利用浏览器时间碎片(空闲时间)计算hash值，防止卡主线程
   */
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

      // deadline:最后期限
      const workLoop = async deadline => {
        // 有任务且有空闲时间(当前帧剩余的毫秒大于0)
        // timeRemaining:剩余时间
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

  /**
   * 异步并发请求数量控制
   * poolLimit: 限制的并发数
   * iterate: 任务数组
   * iteratorFn: 表示迭代函数，用于实现对每个任务项进行处理，该函数会返回一个 Promise 对象或异步函数
   */
  const asyncPool = async(poolLimit, iterate, iteratorFn) => {
    const ret = [];
    const executing = new Set();
    for (const item of iterate) {
      const p = Promise.resolve().then(() => iteratorFn(item, iterate));
      ret.push(p);
      executing.add(p);
      const clean = () => executing.delete(p);
      p.then(clean).catch(clean);
      if (executing.size >= poolLimit) {
        await Promise.race(executing);
      }
    }
    return Promise.all(ret);
  }

  /**
   * 上传文件和发送合并请求
   * fileMd5: 文件md5值
   * chunkIds: 已上传分块ID，用于断点续传
   * poolLimit: 异步数量控制，默认1
   */
  const uploadChunk = async ({fileMd5, chunkIds, poolLimit = 1}) => {
    await asyncPool(poolLimit, [...new Array(fileChunkList.value.length).keys()], (i) => {
      const curChunk = fileChunkList.value[i];
      let formData = new FormData();
      formData.append("file", curChunk.chunk, fileMd5 + "-" + i);
      formData.append("name", currFile.value.name);
      formData.append("timestamp", Date.now());
      // (() => {})(curChunk)函数自执行
      return uploadFile('/single', formData, onUploadProgress(curChunk));
    })
    await mergeChunks('/mergeChunks', { fileName: currFile.value.name, fileMd5 });
  };

  /**
   * 总进度条
   */
  const totalPercentage = computed(() => {
    if (!fileChunkList.value.length) return 0;
    const loaded = fileChunkList.value
      .map(item => item.size * item.percentage)
      .reduce((curr, next) => curr + next);
    return parseInt((loaded / currFile.value.size).toFixed(2));
  });

  /**
   * 每个分块的进度条
   */
  // (() => {})(curChunk)函数自执行，所以可以传入2个参数
  const onUploadProgress = (item) => e => {
    item.percentage = parseInt((e.loaded / e.total) * 100);
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
