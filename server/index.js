// 文件系统fs
const fs = require("fs");
const path = require("path");
// nodejs实用工具类util.promisify返回promise结构
const util = require("util");
// koa：用来快速启动一个web服务器
const Koa = require("koa");
// 解决跨域
const cors = require("@koa/cors");
// 文件上传核心插件
const multer = require("@koa/multer");
// koa的路由处理插件
const Router = require("@koa/router");
// 获得某个目录下的静态文件
const serve = require("koa-static");
// fs-extra是fs的扩展
const fse = require("fs-extra");
// 返回promise结构
const readdir = util.promisify(fs.readdir);
// 文件系统中删除文件
const unlink = util.promisify(fs.unlink);

const app = new Koa();
const router = new Router();
const TMP_DIR = path.join(__dirname, "tmp"); // 临时目录
const UPLOAD_DIR = path.join(__dirname, "/resources");
const IGNORES = [".DS_Store"]; // 忽略的文件列表

// diskStorage方法可控制磁盘存储
const storage = multer.diskStorage({
  // 文件存储目录
  destination: async function (req, file, cb) {
    // file.originalname是4231f394fb29b3ce8c1ef8d55b6a2f19-8格式
    let fileMd5 = file.originalname.split("-")[0];
    const fileDir = path.join(TMP_DIR, fileMd5);
    // 如果目录结构不存在，则创建，否则不创建
    await fse.ensureDir(fileDir);
    cb(null, fileDir);
  },
  // 定义文件名
  filename: function (req, file, cb) {
    let chunkIndex = file.originalname.split("-")[1];
    cb(null, `${chunkIndex}`);
  },
});

// 加载multer，用于文件上传
const multerUpload = multer({ storage });
router.get("/", async (ctx) => {
  ctx.body = "大文件并发上传示例";
});

router.get("/upload/exists", async (ctx) => {
  const { fileName, fileMd5 } = ctx.query;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const isExists = await fse.pathExists(filePath);
  if (isExists) {
    // 是，文件秒传，返回已上传文件的地址
    ctx.body = {
      status: "success",
      data: {
        isExists: true,
        url: `http://localhost:3000/${fileName}`,
      },
    };
  } else {
    // 否则返回已上传的分块ID列表
    let chunkIds = [];
    const chunksPath = path.join(TMP_DIR, fileMd5);
    const hasChunksPath = await fse.pathExists(chunksPath);
    if (hasChunksPath) {
      // 读取目录，参数文件路径
      let files = await readdir(chunksPath);
      chunkIds = files.filter((file) => {
        return IGNORES.indexOf(file) === -1;
      });
    }
    ctx.body = {
      status: "success",
      data: {
        isExists: false,
        chunkIds,
      },
    };
  }
});

// 多文件
// upload.array(文件参数名，最大文件数量)	
// 单文件
// multerUpload.single传递单文件时，需要在请求处理中添加upload.single(fileName)中间件
router.post(
  "/upload/single",
  multerUpload.single("file"),
  async (ctx, next) => {
    ctx.body = {
      code: 1,
      data: ctx.file,
    };
  }
);

router.get("/upload/mergeChunks", async (ctx) => {
  const { fileName, fileMd5 } = ctx.query;
  await mergeChunks(
    path.join(TMP_DIR, fileMd5),
    path.join(UPLOAD_DIR, fileName)
  );
  ctx.body = {
    status: "success",
    data: {
      url: `http://localhost:3000/${fileName}`,
    },
  };
});

async function mergeChunks(sourceDir, targetPath) {
  const readFile = (file, ws) =>
    new Promise((resolve, reject) => {
      // 读取文件，参数文件的路径
      fs.createReadStream(file)
        // 读取成功 
        .on("data", (data) => ws.write(data))
        // 文件读取完毕
        .on("end", resolve)
        .on("error", reject);
    });
  const files = await readdir(sourceDir);
  const sortedFiles = files
    .filter((file) => {
      return IGNORES.indexOf(file) === -1;
    })
    .sort((a, b) => a - b);
  const writeStream = fs.createWriteStream(targetPath);
  for (const file of sortedFiles) {
    let filePath = path.join(sourceDir, file);
    await readFile(filePath, writeStream);
    // 删除已合并的分块
    await unlink(filePath);
  }
  writeStream.end();
}

// 注册中间件
app.use(cors());
app.use(serve(UPLOAD_DIR));
app.use(router.routes()).use(router.allowedMethods());

app.listen(3000, () => {
  console.log("app starting at port 3000");
});