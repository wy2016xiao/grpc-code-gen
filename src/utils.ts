import * as path from "path";

export const BASE_DIR = path.join(process.cwd(), 'code-gen');

export const tslintDisable = `// tslint:disable`;
export const fileTip = `// This file is auto generated by grpc-code-gen, do not edit!`;

export const PROTO_TYPE_2_TS_TYPE_MAP: { [key: string]: string } = {
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

export const PROTO_TYPE_2_JSON_SEMANTIC_MAP: { [key: string]: string } = {
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

export function getImportPath(fromPath: string, toPath: string) {
  let relative = path.relative(path.dirname(fromPath), toPath);
  relative = relative
    .replace(/\.(js|d\.ts|ts)$/, '')
    .replace(/\\/g, '/');
  if (!/^\./.test(relative)) {
    relative = `./${relative}`;
  }
  return relative;
}

export function getPackageName(fullName: string): string {
  let split = fullName.split('.');
  return split.slice(0, split.length - 1).join('.');
}

export function getAbsPath(relativePath: string, baseDir: string = BASE_DIR): string {
  return path.join(baseDir, relativePath);
}