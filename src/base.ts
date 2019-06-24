import * as fs from 'fs-extra';
import { IOption, loadProto } from 'load-proto';
import { get, set } from 'lodash';
import * as path from 'path';
import { Root } from 'protobufjs';
import { inspectNamespace } from "./pbjs";
import { TEnum, TMessage, TMethod, TService } from "./types";

const BASE_DIR = path.join(process.cwd(), 'code-gen');

function getPackageName(fullName: string): string {
  let split = fullName.split('.');
  return split.slice(0, split.length - 1).join('.');
}

function getAbsPath(relativePath: string, baseDir: string = BASE_DIR): string {
  return path.join(baseDir, relativePath);
}

interface TNamespace {
  messages?: { [name: string]: TMessage };
  enums?: { [name: string]: TEnum };
  nested?: { [name: string]: TNamespace };
}

function genSpace(num: number) {
  let space = '';
  for (let i = 0; i < num; i++) {
    space += ' ';
  }
  return space;
}

const fileTip = `// This file is auto generated by grpc-code-gen, do not edit!`;

const PROTO_TYPE_2_TS_TYPE_MAP: { [key: string]: string } = {
  'double': 'number',
  'float': 'number',
  'int32': 'number',
  'int64': 'number',
  'uint32': 'number',
  'uint64': 'number',
  'sint32': 'number',
  'sint64': 'number',
  'fixed32': 'number',
  'fixed64': 'number',
  'sfixed32': 'number',
  'sfixed64': 'number',
  'bool': 'boolean',
  'string': 'string',
  'bytes': 'string',
};

const PROTO_TYPE_2_JSON_SEMANTIC_MAP: { [key: string]: string } = {
  'double': 'NumberSchema',
  'float': 'NumberSchema',
  'int32': 'NumberSchema',
  'int64': 'NumberSchema',
  'uint32': 'NumberSchema',
  'uint64': 'NumberSchema',
  'sint32': 'NumberSchema',
  'sint64': 'NumberSchema',
  'fixed32': 'NumberSchema',
  'fixed64': 'NumberSchema',
  'sfixed32': 'NumberSchema',
  'sfixed64': 'NumberSchema',
  'bool': 'BooleanSchema',
  'string': 'StringSchema',
  'bytes': 'StringSchema',
};

function walkPackagePath(packagePath: string, type: string, map: { [key: string]: any }): string | null {
  if (map[`${packagePath}.${type}`]) {
    return `${packagePath}.${type}`;
  }
  const split = packagePath.split('.');
  if (split.length === 1) {
    return null;
  }
  return walkPackagePath(split.slice(0, split.length - 1).join('.'), type, map);
}

function getTsType(
  protoType: string,
  fullName: string,
  config: {
    root: Root,
    messageMap: { [key: string]: TMessage },
    enumMap: { [key: string]: TEnum },
  },
  isArr?: boolean,
): { tsType: string, semanticType?: string, basic: boolean } {
  const basic = PROTO_TYPE_2_TS_TYPE_MAP[protoType];
  if (basic) {
    return {
      tsType: basic,
      semanticType: PROTO_TYPE_2_JSON_SEMANTIC_MAP[protoType],
      basic: true,
    }
  }

  if (/\./.test(protoType)) {
    return {
      tsType: protoType,
      semanticType: isArr ? `ArraySchemaWithGenerics<${protoType}>` : undefined,
      basic: false,
    };
  }

  const { messageMap, enumMap, root } = config;

  let tsType = walkPackagePath(fullName, protoType, messageMap) ||
    walkPackagePath(fullName, protoType, enumMap);

  if (!tsType) {
    const typeOrEnum = root.lookupTypeOrEnum(protoType);
    if (typeOrEnum) {
      tsType = typeOrEnum.fullName.replace(/^\./, '');
    }
  }

  if (tsType) {
    return {
      tsType: tsType,
      semanticType: isArr ? `ArraySchemaWithGenerics<${tsType}>` : undefined,
      basic: false,
    };
  }
  throw new Error(`${protoType} not exist in message: ${fullName}`);
}

function genTsType(
  namespace: TNamespace,
  config: {
    root: Root,
    messageMap: { [key: string]: TMessage },
    enumMap: { [key: string]: TEnum },
    withJsonSemantic?: boolean,
  },
  deep: number = 0,
): string {
  let str = '';
  const { messages, enums, nested } = namespace;
  const space = genSpace(deep * 2);
  if (messages) {
    str += Object
      .keys(messages)
      .sort((a, b) => {
        if (a < b) {
          return -1;
        }
        if (a > b) {
          return 1;
        }
        return 0;
      })
      .map((name) => {
        const message = messages[name];
        const fieldDefine = message.fields
          .map((field) => {
            const isArr = field.repeated;
            const { tsType, semanticType } = getTsType(field.type, message.fullName, config, isArr);

            let res = `${space}  '${field.name}'${field.required ? '' : '?'}: `;

            if (isArr) {
              if (config.withJsonSemantic && semanticType) {
                res += `Array<${tsType} | ${semanticType}>;`;
              } else {
                res += `${tsType}${isArr ? '[]' : ''};`
              }
            } else {
              if (config.withJsonSemantic && semanticType) {
                res += `${tsType} | ${semanticType};`;
              } else {
                res += `${tsType};`;
              }
            }
            return res;
          });
        return [
          `${space}export interface ${name} {`,
          ...fieldDefine,
          `${space}}`,
        ].join('\n') + '\n';
      })
      .join('\n\n') + '\n\n';
  }
  if (enums) {
    str += Object.keys(enums)
      .sort((a, b) => {
        if (a < b) {
          return -1;
        }
        if (a > b) {
          return 1;
        }
        return 0;
      })
      .map((name) => {
        const enumT = enums[name];
        const fieldDefine = Object.keys(enumT.values)
          .map((key) => {
            return `${space}  ${key} = ${enumT.values[key]},`;
          });
        return [
          `${space}export enum ${name} {`,
          ...fieldDefine,
          `${space}}`,
        ].join('\n') + '\n';
      })
      .join('\n\n') + '\n\n';
  }
  if (nested) {
    const nextDeep = deep + 1;
    Object
      .keys(nested)
      .sort((a, b) => {
        if (a < b) {
          return -1;
        }
        if (a > b) {
          return 1;
        }
        return 0;
      })
      .map((name) => {
        str += `${space}export namespace ${name} {\n`;
        str += genTsType(nested[name], config, nextDeep);
        str += `${space}}\n`;
      });
  }
  return str;
}

function getImportPath(fromPath: string, toPath: string) {
  let relative = path.relative(path.dirname(fromPath), toPath);
  relative = relative
    .replace(/\.(js|d\.ts|ts)$/, '')
    .replace(/\\/g, '/');
  if (!/^\./.test(relative)) {
    relative = `./${relative}`;
  }
  return relative;
}

export interface Options extends IOption {
  baseDir?: string;
  target?: 'javascript' | 'typescript';
  jsonSemanticTypes?: boolean;
  serviceCode?: boolean;
  configFilePath?: string;
  grpcNpmName?: string;
}

export async function gen(opt: Options): Promise<string> {
  const {
    baseDir = BASE_DIR,
    target = 'typescript',
    serviceCode = true,
    jsonSemanticTypes = false,
    configFilePath,
    gitUrls,
    branch,
    accessToken,
    resolvePath,
    grpcNpmName = '@grpc/grpc-js',
  } = opt;

  const typescript = target === 'typescript';
  const grpcNative = grpcNpmName === 'grpc';

  fs.removeSync(baseDir);
  console.info(`Clean dir: ${baseDir}`);

  fs.mkdirpSync(baseDir);

  const root = await loadProto({
    gitUrls,
    branch,
    accessToken,
    resolvePath,
  });
  root.resolveAll();

  const json = root.toJSON({ keepComments: true });

  fs.mkdirpSync(path.join(process.cwd(), '.grpc-code-gen'));

  const jsonPath = path.join(process.cwd(), '.grpc-code-gen', 'root.json');
  await fs.writeJSON(jsonPath, json);

  const moduleSuffix = typescript ? 'ts' : 'js';

  const result = inspectNamespace(root);

  if (!result) {
    throw new Error('None code gen');
  }

  const { services, methods, messages, enums } = result;

  const messageMap: { [key: string]: TMessage } = {};
  const enumMap: { [key: string]: TEnum } = {};

  const namespace: TNamespace = {};
  messages.forEach((message) => {
    const packageName = getPackageName(message.fullName);
    const nameSpacePath = 'nested.' + packageName.replace(/\./g, '.nested.');
    const latest = get(namespace, nameSpacePath, { messages: {} });
    latest.messages[message.name] = message;
    set(namespace, nameSpacePath, latest);

    messageMap[message.fullName] = message;
  });
  enums.forEach((enumT) => {
    const packageName = getPackageName(enumT.fullName);
    const nameSpacePath = 'nested.' + packageName.replace(/\./g, '.nested.');
    const latest = get(namespace, nameSpacePath, { enums: {} });
    latest.enums[enumT.name] = enumT;
    set(namespace, nameSpacePath, latest);

    enumMap[enumT.fullName] = enumT;
  });

  if (jsonSemanticTypes) {
    const jsonSemanticTypesPath = getAbsPath('jsonSemanticTypes.ts', baseDir);
    await fs.writeFile(
      jsonSemanticTypesPath,
      fileTip + '\n'
      + 'import { ArraySchemaWithGenerics, BooleanSchema, NumberSchema, StringSchema } from \'json-semantic\';\n\n'
      + genTsType(namespace, { root, messageMap, enumMap, withJsonSemantic: true })
      + `
export interface ICase<Request, Response> {
    id: string;
    name: string;
    desc?: string;
    request: Request;
    response?: Response;
    error?: {
        code: number,
        details: string,
        metadata: {
            internalRepr: {}
        }
    }
}
      `,
    );
  }

  if (serviceCode) {
    const grpcObjPath = getAbsPath(`grpcObj.${moduleSuffix}`, baseDir);
    const grpcClientPath = getAbsPath(`getGrpcClient.${moduleSuffix}`, baseDir);
    if (typescript) {
      await fs.writeFile(grpcObjPath, [
        fileTip,
        `import * as grpc from '${grpcNpmName}';`,
        `import { Status } from '@grpc/grpc-js/build/src/constants';`,
        `import * as fs from 'fs';`,
        `import { forOwn } from 'lodash';`,
        `import { loadFromJson } from 'load-proto';\n`,
        `const root = require('${getImportPath(grpcObjPath, jsonPath)}');\n`,
        `let config;`,
        `if (fs.existsSync(require.resolve('${getImportPath(grpcObjPath, configFilePath as string)}'))) {
  config = require('${getImportPath(grpcObjPath, configFilePath as string)}');
}`,
        `const grpcObject = grpc.loadPackageDefinition(loadFromJson(`,
        `  root,`,
        `  (config && config.loaderOptions) || { defaults: true },`,
        `));\n`,
        `// fix: grpc-message header split by comma
grpc.Metadata.prototype.getMap = function() {
  const result: any = {};
  const collection = (this as any).internalRepr;
  if (collection.forEach) {
    collection.forEach((values: any, key: string) => {
      if (values.length > 0) {
        result[key] = values.map((v: any) => {
          return v instanceof Buffer ? v.slice() : v;
        }).join(',')
      }
    });
  } else {
    forOwn(collection, (values, key) => {
      if (values.length > 0) {
        // const v = values[0];
        result[key] = values.map((v: any) => {
          return v instanceof Buffer ? v.slice() : v;
        }).join(',')
      }
    });
  }
  return result;
};

(grpc.Client.prototype as any).handleUnaryResponse = function(call: any, deserialize: any, callback: any) {
  let responseMessage:any = null;
  call.on('data', (data: any) => {
    if (responseMessage != null) {
      call.cancelWithStatus(Status.INTERNAL, 'Too many responses received');
    }
    try {
      responseMessage = deserialize(data);
    } catch (e) {
      call.cancelWithStatus(Status.INTERNAL, 'Failed to parse server response');
    }
  });
  call.on('end', () => {
    if (responseMessage == null) {
      call.cancelWithStatus(Status.INTERNAL, 'Not enough responses received');
    }
  });
  call.on('status', (status: any) => {
    // 增加返回参数metadata
    if (status.code === Status.OK) {
      callback(null, responseMessage, status.metadata);
    } else {
      const error = Object.assign(new Error(status.details), status);
      callback(error, null, status.metadata);
    }
  });
};
      `,
        `export default grpcObject;`,
      ].join('\n'));

      const grpcCodeGenPath = path.join(process.cwd(), '.grpc-code-gen');
      await fs.writeFile(grpcClientPath, [
        fileTip,
        `
import * as grpc from "@grpc/grpc-js/";
import { ChannelCredentials } from "@grpc/grpc-js//build/src/channel-credentials";
import * as fs from 'fs';
import * as path from 'path';

export interface IService<S> {
  $FILE_NAME: string;

  new(address: string, credentials: ChannelCredentials, options?: object): S;
}

let grpcServiceConfig: {
  [key: string]: {
    server_name: string;
    server_port: number;
    cert_pem_path: string | undefined;
  }
};

const codeGenConfig = require('${getImportPath(grpcClientPath, path.join(process.cwd(), 'grpc-code-gen.config.js'))}');

const globalConfigPath = path.resolve(__dirname, '${getImportPath(grpcClientPath, path.join(grpcCodeGenPath, 'config.json'))}');
if (!fs.existsSync(globalConfigPath)) {
  console.error('Please run: "yarn grpc-gen" first');
  process.exit(-1);
}

const grpcServiceConfigPath = path.resolve(__dirname, '${getImportPath(grpcClientPath, path.join(process.cwd(), 'grpc-service.config.js'))}.js');
grpcServiceConfig = require(globalConfigPath);

let grpcServiceConfigLocal: any = {};
const serviceConfigFileExist = fs.existsSync(grpcServiceConfigPath);
if (serviceConfigFileExist) {
  grpcServiceConfigLocal = require(grpcServiceConfigPath);
  console.info('---------------------------');
  console.info('Use local service config: ');
  console.info(JSON.stringify(grpcServiceConfigLocal, (key, value) => value, 2));
  console.info('---------------------------');
}

export default function getGrpcClient<S>(service: IService<S>): S {
  const exec = /\\/([^/]+)-proto\\//.exec(service.$FILE_NAME);

  if (exec) {
    const serverName = exec[1];
    const configLocal = grpcServiceConfigLocal[serverName];
    if (serviceConfigFileExist && !configLocal) {
      console.warn(\`Service: \$\{serverName\} not setting local, use global config, please ensure have set hosts\`)
    }
    const config = configLocal || grpcServiceConfig[serverName];
    if (config) {
      let credentials;
      if (config.cert_pem_path) {
        credentials = grpc.credentials.createSsl(
          fs.readFileSync(path.join(__dirname, '${getImportPath(grpcClientPath, path.join(grpcCodeGenPath, 'ca.pem'))}')),
        );
      } else {
        credentials = grpc.credentials.createInsecure();
      }
      
      let options;
      const {
        clientOptions = {},
      } = codeGenConfig;

      const defaultOptions = {
        'grpc.ssl_target_name_override': serverName,
        'grpc.keepalive_time_ms': 3000,
        'grpc.keepalive_timeout_ms': 2000,
      };

      if (typeof clientOptions === 'function') {
        options = clientOptions(defaultOptions);
      } else {
        options = Object.assign(defaultOptions, clientOptions);
      }

      return new service(\`\$\{config.server_name\}:\$\{config.server_port\}\`, credentials, options);
    }
  }
  throw new Error(\`\$\{service.$FILE_NAME\} config not exists!\`);
}
`,
      ].join('\n'));
    } else {
      await fs.writeFile(grpcObjPath, [
        fileTip,
        `const grpc = require('${grpcNpmName}');`,
        `const { loadFromJson } = require('load-proto');`,
        `const root = require('${getImportPath(grpcObjPath, jsonPath)}');\n`,
        `const grpcObject = grpc.loadPackageDefinition(loadFromJson(root));`,
        `module.exports = grpcObject;`,
        `module.exports.default = grpcObject;`,
      ].join('\n'));
    }

    const typesPath = getAbsPath('types.ts', baseDir);

    await fs.writeFile(
      typesPath,
      fileTip + '\n'
      + genTsType(namespace, { root, messageMap, enumMap }),
    );

    const servicesWithMethods: { [fullName: string]: TService & { methods: TMethod[] } } = {};
    services.forEach((service) => {
      servicesWithMethods[service.fullName] = { ...service, methods: [] };
    });
    methods.forEach((method) => {
      const packageName = getPackageName(method.fullName);
      const serviceWithMethod = servicesWithMethods[packageName];
      if (serviceWithMethod) {
        serviceWithMethod.methods.push(method);
      }
    });
    services.map(async (service) => {
      const packageName = getPackageName(service.fullName).replace(/\./g, '/');
      const servicePath = getAbsPath(`${service.fullName.replace(/\./g, '/')}.${moduleSuffix}`, baseDir);
      const serviceDTsPath = getAbsPath(`${service.fullName.replace(/\./g, '/')}.d.ts`, baseDir);

      await fs.mkdirp(getAbsPath(packageName, baseDir));

      const serviceWithMethod = servicesWithMethods[service.fullName];
      const config = {
        messageMap,
        enumMap,
        root,
      };
      const methodStrArr = serviceWithMethod.methods
        .sort((a, b) => {
          if (a.name < b.name) {
            return -1;
          }
          if (a.name > b.name) {
            return 1;
          }
          return 0;
        })
        .map((method) => {
          const requestType = 'types.' + getTsType(method.requestType, packageName, config).tsType;
          const responseType = `types.${getTsType(method.responseType, packageName, config).tsType}`;
          return `  /** @deprecated 请使用: ${method.name}V2 */
  ${method.name}(
    request: ${requestType},
    options?: { timeout?: number; flags?: number; host?: string; }
  ): Promise<${responseType}>;
  /** @deprecated 请使用: ${method.name}V2 */
  ${method.name}(
    request: ${requestType},
    metadata: MetadataMap,
    options?: { timeout?: number; flags?: number; host?: string; }
  ): Promise<${responseType}>;
  ${method.name}V2(option: {
    request: ${requestType};
    metadata?: MetadataMap;
    options?: { timeout?: number; flags?: number; host?: string; };
  }): Promise<{ response:${responseType}, metadata: Metadata }>;
`
        });

      if (typescript) {
        const typeName = 'I' + service.name;
        await fs.writeFile(servicePath, [
          fileTip,
          `import { Metadata } from "@grpc/grpc-js";`,
          `import * as grpc from '@grpc/grpc-js';`,
          `import { get } from 'lodash';`,
          `import grpcObject from '${getImportPath(servicePath, grpcObjPath)}';\n`,
          `import { ChannelCredentials } from "${grpcNative ? 'grpc' : `${grpcNpmName}/build/src/channel-credentials`}";`,
          `import { promisify } from 'util';`,
          `import * as types from '${getImportPath(servicePath, typesPath)}';\n`,
          `import getGrpcClient from '${getImportPath(servicePath, grpcClientPath)}';\n`,
          `const config = require('${getImportPath(servicePath, configFilePath as string)}');\n`,
          `const logOptions = config.logOptions ? { ...config.logOptions } : { enable: true, attributes: ['request'] } \n`,
          `const callOptions = config.callOptions ? { ...config.callOptions } : {} \n`,
          `export interface ${typeName} {`,
          `  $FILE_NAME: string;`,
          `  new (address: string, credentials: ChannelCredentials, options?: object): ${typeName};\n`,
          ...methodStrArr,
          `}`,
          `const Service: ${typeName} = get<any, string>(grpcObject, '${service.fullName}');`,
          `Service.$FILE_NAME = '${service.filename && service.filename.replace(/\\/g, '/')}';`,
          `
const maxTry = 3;

type MetadataMap = { [key: string]: string | number | Buffer };

interface ReqOptions {
  request: any;
  metadata?: Metadata;
  options: any;
}

function toMetadata(metadata: MetadataMap): Metadata {
  const metadataIns = new grpc.Metadata();
  if (metadata && typeof metadata === "object") {
    Object.keys(metadata).forEach((keyName) => {
      metadataIns.add(keyName, metadata[keyName] as string);
    });
  }
  return metadataIns;
}

Object.keys(Service.prototype).forEach((key) => {
  if (!/^\\$/.test(key)) {
    const origin = Service.prototype[key];
    const methodId = origin.path.replace(/\\//g, '.').replace(/^\\./, '');
    const wrapper = function(this: any, request: any, metadata: MetadataMap, options: any, callback: any) {
      switch (arguments.length) {
        case 2:
          callback = metadata;
          metadata = {};
          options = {};
          break;
        case 3:
          callback = options;
          options = metadata;
          metadata = {};
          break;
      }

      options = Object.assign({}, callOptions, options);
      
      let count = 0;

      function doCall(self: any) {
        if (typeof options.timeout === 'number') {
          options.deadline = Date.now() + options.timeout;
        }

        const start = Date.now();
        (origin as any).apply(self, [request, toMetadata(metadata), options, function(err: any, response: any, metadataRes: Metadata) {
          if (!logOptions.disable) {
            const duration = (Date.now() - start) / 1000;
            console.info(
              'grpc invoke:', methodId,
              'duration:', duration + 's',
              'metadata:', JSON.stringify(metadata),
              'request:', JSON.stringify(request),
            );
            if (err) {
              console.error(
                'grpc invoke:', methodId,
                'duration:', duration + 's',
                'metadata:', JSON.stringify(metadata),
                'request:', JSON.stringify(request),
                'err:', err,
              );
            }
          }

          if (err && count < maxTry && /^Internal HTTP2 error/.test(err.details || err.message || err.data)) {
            count++;
            setTimeout(() => {
              doCall(self);
            }, 25);
          } else {
            callback(err, response, metadataRes);
          }
        }]);
      }

      doCall(this);
    };
    Service.prototype[key] = promisify(wrapper);
    Service.prototype[\`\$\{key\}V2\`] = function(option: ReqOptions) {
      const { request, metadata, options } = option;
      return new Promise((resolve, reject) => {
        wrapper.call(this, request, metadata, options, (err: Error | null, res: any, metadataRes: Metadata) => {
          if (err) {
            reject(err);
            return;
          }
          resolve({ response: res, metadata: metadataRes });
        });
      });
    };
  }
});`,
          `export const ${service.name}: ${typeName} = Service;`,
          `export default ${service.name};`,
          `export const ${service.name[0].toLowerCase()}${service.name.slice(1)} = getGrpcClient<${typeName}>(${service.name});\n`,
        ].join('\n'));
      } else {
        await fs.writeFile(servicePath, [
          fileTip,
          `const grpc = require('@grpc/grpc-js');`,
          `const { get } = require('lodash');`,
          `const { promisify } = require('util');`,
          `const grpcObject = require('${getImportPath(servicePath, grpcObjPath)}');\n`,
          `const config = require('${getImportPath(servicePath, configFilePath as string)}');\n`,
          `const logOptions = config.logOptions ? { ...config.logOptions } : { disable: false, attributes: ['request'] } \n`,
          `const callOptions = config.callOptions ? { ...config.callOptions } : {} \n`,
          `const ${service.name} = get(grpcObject, '${service.fullName}');`,
          `${service.name}.$FILE_NAME = '${service.filename}';`,
          `
const maxTry = 3;

function toMetadata(metadata) {
  const metadataIns = new grpc.Metadata();
  if (metadata && typeof metadata === "object") {
    Object.keys(metadata).forEach((keyName) => {
      metadataIns.add(keyName, metadata[keyName]);
    });
  }
  return metadataIns;
}

Object.keys(${service.name}.prototype).forEach((key) => {
  if (!/^\\$/.test(key)) {
    const origin = ${service.name}.prototype[key];
    const methodId = origin.path.replace(/\\//g, '.').replace(/^\\./, '');
    const wrapper = function(request, metadata, options, callback) {
      switch (arguments.length) {
        case 2:
          callback = metadata;
          metadata = {};
          options = {};
          break;
        case 3:
          callback = options;
          options = metadata;
          metadata = {};
          break;
      }

      options = Object.assign({}, callOptions, options);
      
      let count = 0;

      function doCall(self) {
        if (typeof options.timeout === 'number') {
          options.deadline = Date.now() + options.timeout;
        }

        const start = Date.now();
        origin.apply(self, [request, toMetadata(metadata), options, function(err, response, metadata) {
          if (!logOptions.disable) {
            const duration = (Date.now() - start) / 1000;
            console.info(
              'grpc invoke:', methodId,
              'duration:', duration + 's',
              'metadata:', JSON.stringify(metadata),
              'request:', JSON.stringify(request),
            );
            if (err) {
              console.error(
                'grpc invoke:', methodId,
                'duration:', duration + 's',
                'metadata:', JSON.stringify(metadata),
                'request:', JSON.stringify(request),
                'err:', err,
              );
            }
          }

          if (err && count < maxTry && /^Internal HTTP2 error/.test(err.details || err.message || err.data)) {
            count++;
            setTimeout(() => {
              doCall(self);
            }, 25);
          } else {
            callback(err, response, metadata);
          }
        }]);
      }

      doCall(this);
    };
    ${service.name}.prototype[key] = promisify(wrapper);
    ${service.name}.prototype[\`\$\{key\}V2\`] = function(option) {
      const { request, metadata, options } = option;
      return new Promise((resolve, reject) => {
        wrapper.call(this, request, metadata, options, (err, res, metadataRes) => {
          if (err) {
            reject(err);
            return;
          }
          resolve({ response: res, metadata: metadataRes });
        });
      });
    };
  }
});`,
          `module.exports.${service.name} = ${service.name};\n`,
          `module.exports.default = ${service.name};\n`,
        ].join('\n'));

        // .d.ts
        await fs.writeFile(serviceDTsPath, [
          fileTip,
          `import { ChannelCredentials } from "${grpcNative ? 'grpc' : `${grpcNpmName}/build/src/channel-credentials`}";`,
          `import * as types from '${getImportPath(serviceDTsPath, typesPath)}';\n`,
          `export class ${service.name} {`,
          `  static $FILE_NAME: string;`,
          `  constructor(address: string, credentials: ChannelCredentials, options?: object)`,
          ...methodStrArr,
          `}`,
          `export default ${service.name};\n`,
        ].join('\n'));
      }
    });
  }

  console.info(`Generate success in ${baseDir}`);
  return baseDir;
}
