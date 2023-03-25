self.importScripts('../spark-md5.min.js');
self.onmessage = (e) => {
  let fileChunkList = e.data.fileChunkList,
    fileReader = new FileReader(),
    spark = new SparkMD5.ArrayBuffer(),
    currChunk = 0;
  
  fileReader.onload = (e) => {
    let chunk = e.target.result;
    spark.append(chunk);
    currChunk++;
    if (currChunk < fileChunkList.length) {
      loadNext(currChunk);
    } else {
      self.postMessage({ fileMd5: spark.end() });
    }
  };

  fileReader.onerror = () => {
    console.warn('oops, something went wrong.');
  };

  function loadNext(index) {
    fileReader.readAsArrayBuffer(fileChunkList[index].chunk);
  }
  loadNext(0)
}