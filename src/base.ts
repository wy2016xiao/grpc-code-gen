import * as fs from 'fs-extra';
import { IOption, loadProto, IGitConfigWithUrl } from 'load-proto';
import { Options as LoaderOptions } from 'load-proto/build/loader';
import { get, set } from 'lodash';
import * as path from 'path';
import genGetGrpcClient from "./genGetGrpcClient";
import genGrpcObj from "./genGrpcObj";
import genServices from "./genServices";
import genServiceWrapper from "./genServiceWrapper";
import genTsType from "./genTsType";
import { inspectNamespace } from "./pbjs";
import { TNamespace } from "./types";
import { getAbsPath, getPackageName } from "./utils";

const BASE_DIR = path.join(process.cwd(), 'code-gen');

type GitConfig = IGitConfigWithUrl & { host?: string; } & { type: string; deps: string[]; };

export interface Options extends IOption {
  baseDir?: string;
  target?: 'javascript' | 'typescript';
  configFilePath?: string;
  grpcNpmName?: string;
  loaderOptions?: LoaderOptions;
  gitUrls: Array<GitConfig | string>;
}

export async function gen(opt: Options): Promise<string> {
  const {
    baseDir = BASE_DIR,
    target = 'typescript',
    configFilePath,
    branch,
    accessToken,
    resolvePath,
    grpcNpmName = 'grpc',
    loaderOptions,
    loadProtoPlugin
  } = opt;
  let { gitUrls } = opt;

  // 先清空一波旧有文件
  fs.removeSync(baseDir);
  console.info(`Clean dir: ${baseDir}`);

  fs.mkdirpSync(baseDir);

  if (gitUrls.length <= 1) {
    throw new Error('gitUrls must be more than two parameters');
  }

  const firstUrl = gitUrls.splice(0, 1)

  // 检测是否有依赖proto配置，先匹配出依赖项
  // 依赖一般配置在对象参数的deps中,值为仓库地址

  /**
   * 配置项的依赖仓库地址集合
   */
  const libMap: { [url: string]: GitConfig } = {}
  gitUrls = gitUrls.filter((item) => {
    // 如果type === 'lib'证明这是个依赖,则删掉
    if (typeof (item) === 'object' && item.type === "lib"){
      libMap[item.url] = item;
      return false;
    }
    return true;
  });

  let allResult: Array<{ result: any, root: any, [propname: string]: any }> = []
  let alljson: { [propname: string]: any } = {}

  await Promise.all(gitUrls.map(async (gitConfig: GitConfig | string) => {
    /**
     * 依赖的仓库地址列表
     */
    let deps: Array<GitConfig | string> = [];

    if (typeof (gitConfig) === 'object' && gitConfig.deps && gitConfig.deps.length) {
      // 针对有依赖的配置项
      // 去查询libMap中有没有记录
      // 如果没有,证明有配置项声明了依赖但是没有配置依赖仓库,直接报错
      // 如果有,压入deps中
      deps = gitConfig.deps.map((item: string)=>{
        const lib = libMap[item];
        if (!lib) {
          console.error(`${gitConfig.url} dep ${item} not exist`)
          process.exit(-1);
        }
        return lib
      });
    }
    /**
     * 配置项的仓库地址
     */
    const newUrl: string = typeof gitConfig === 'string' ? gitConfig : gitConfig.url
    /**
     * 配置项的host
     */
    const host: string = typeof gitConfig === 'object' ? (gitConfig.host ||'' ) : ''
    const root = await loadProto({
      gitUrls: [...firstUrl, ...deps, gitConfig],
      branch,
      accessToken,
      resolvePath,
      loadProtoPlugin
    });
    root.resolveAll();
    const json: any = root.toJSON({ keepComments: true });

    let [service, space] = newUrl
      .replace(/:/g, '/')
      .replace(/(-proto\.git|\.git)/, '')
      .split('/')
      .reverse();

    allResult.push({
      result: inspectNamespace(root),
      root,
      space,
      service,
      host
    })
    alljson[`${space}_${service.replace(/-/g, '_')}`] = json
  }))


  fs.mkdirpSync(path.join(process.cwd(), '.grpc-code-gen'));

  const jsonPath = path.join(process.cwd(), '.grpc-code-gen', 'root.json');
  await fs.writeJSON(jsonPath, alljson);

  if (!allResult.length) {
    throw new Error('None code gen');
  }


  const grpcObjPath = getAbsPath(`grpcObj.ts`, baseDir);
  await fs.writeFile(
    grpcObjPath,
    genGrpcObj({
      grpcNpmName,
      configFilePath: configFilePath as string,
      grpcObjPath,
      jsonPath,
    }),
  );

  const grpcClientPath = getAbsPath(`getGrpcClient.ts`, baseDir);
  await fs.writeFile(
    grpcClientPath,
    genGetGrpcClient(grpcNpmName, grpcClientPath),
  );


  const serviceWrapperPath = getAbsPath(`serviceWrapper.ts`, baseDir);
  await fs.writeFile(
    serviceWrapperPath,
    genServiceWrapper({
      configFilePath: configFilePath as string,
      grpcNpmName,
      serviceWrapperPath,
    }),
  );


  allResult.map(async (item: { result: any, root: any, [propname: string]: any }, index: number) => {

    const { result, root, space, service, host } = item
    const { services, methods, messages, enums } = result;

    const namespace: TNamespace = {};
    messages.forEach((message: any) => {
      const packageName = getPackageName(message.fullName);
      const nameSpacePath = 'nested.' + packageName.replace(/\./g, '.nested.');
      const latest = get(namespace, nameSpacePath, { messages: {} });
      if (!latest.messages) latest.messages = {}
      latest.messages[message.name] = message;
      set(namespace, nameSpacePath, latest);
    });
    enums.forEach((enumT: any) => {
      const packageName = getPackageName(enumT.fullName);
      const nameSpacePath = 'nested.' + packageName.replace(/\./g, '.nested.');
      const latest = get(namespace, nameSpacePath, { enums: {} });
      if (!latest.enums) latest.enums = {}
      latest.enums[enumT.name] = enumT;
      set(namespace, nameSpacePath, latest);
    });

    const typesPath = getAbsPath('types.ts', space && service ? `${baseDir}/${space}/${service}` : baseDir);
    space && service && await fs.mkdirp(`${baseDir}/${space}/${service}`);
    await fs.writeFile(
      typesPath,
      genTsType({ namespace, root, messages, enums, loaderOptions }),
    );

    await genServices({
      grpcClientPath,
      serviceWrapperPath,
      messages,
      methods,
      grpcNpmName,
      configFilePath: configFilePath as string,
      grpcObjPath,
      baseDir,
      enums,
      root,
      services,
      typesPath,
      loaderOptions,
      space,
      service,
      host
    });

  })




  console.info(`Generate success in ${baseDir}`);

  return baseDir;
}
