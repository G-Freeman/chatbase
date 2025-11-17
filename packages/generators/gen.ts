import fs from 'fs';
import path from 'path';
import ts from 'typescript';

type OpenAPISchema = Record<string, any>;

type SchemaContext = {
	knownTypeNames: Set<string>;
	schemas: Record<string, OpenAPISchema>;
};

type ParamInfo = {
	name: string;
	schema: OpenAPISchema;
	typeNode?: ts.TypeNode;
	declaration: ts.ParameterDeclaration;
	description?: string;
	defaultValue?: unknown;
};

type PathParam = {
	name: string;
	schema: OpenAPISchema;
	required: boolean;
	description?: string;
};

type HttpEndpoint = {
	name: string;
	method: string;
	path: string;
	summary?: string;
	description?: string;
	pathParams: PathParam[];
	requestBody?: {
		schema: OpenAPISchema;
		description?: string;
	};
	responseSchema?: OpenAPISchema;
	tags: string[];
};

type WsEvent = {
	name: string;
	schema: OpenAPISchema;
	description?: string;
	channel?: string;
};

type WsPublish = {
	schema: OpenAPISchema;
	description?: string;
};

type ResolvedPlaceholder = {
	name: string;
	schema: OpenAPISchema;
	description?: string;
};

type WsOutgoing = {
	name: string;
	schema: OpenAPISchema;
	description?: string;
	channel: string;
	example?: any;
};

const packagesRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packagesRoot, '..');
const httpDir = path.resolve(packagesRoot, 'api/http');
const socketDir = path.resolve(packagesRoot, 'api/socket');
const docsRoot = path.resolve(packagesRoot, 'docs');
const schemasDir = path.join(docsRoot, 'public', 'schemas');

const envConfig = loadEnv(path.join(repoRoot, '.env'));

main();

function main() {
	const httpTypesCtx = collectTypeDeclarations([
		path.resolve(packagesRoot, 'types/index.ts'),
	]);

	const httpBaseUrl = normalizeHttpUrl(envConfig.VITE_URL_HTTP, extractHttpBaseUrl());
	const httpEndpoints = collectHttpEndpoints(httpTypesCtx);
	const httpDoc = buildHttpOpenApi(httpEndpoints, httpTypesCtx.schemas, httpBaseUrl);
	writeJson(path.join(schemasDir, 'http.json'), httpDoc);

	const socketTypeFiles = fs
		.readdirSync(socketDir)
		.filter(f => f.endsWith('.ts'))
		.map(f => path.join(socketDir, f));
	const wsTypesCtx = collectTypeDeclarations([
		path.resolve(packagesRoot, 'types/index.ts'),
		...socketTypeFiles,
	]);
	const wsServerUrl = normalizeWsUrl(envConfig.VITE_URL_SOCKET, extractWsServerUrl());
	const { events, publish, outgoing } = collectWsArtifacts(wsTypesCtx);
	const wsDoc = buildWsOpenApi(events, publish, outgoing, wsTypesCtx.schemas, wsServerUrl);
	writeJson(path.join(schemasDir, 'socket.json'), wsDoc);

	console.log('Generated Scalar docs:');
	console.log(' -', path.join('docs', 'public', 'schemas', 'http.json'));
	console.log(' -', path.join('docs', 'public', 'schemas', 'socket.json'));
}

function ensureDir(dir: string) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(outPath: string, payload: unknown) {
	ensureDir(path.dirname(outPath));
	fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
}

function loadEnv(filePath: string): Record<string, string> {
	const env: Record<string, string> = {};
	if (!fs.existsSync(filePath)) return env;
	const content = fs.readFileSync(filePath, 'utf8');
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) continue;
		const key = trimmed.slice(0, eqIndex).trim();
		let value = trimmed.slice(eqIndex + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		env[key] = value;
	}
	return env;
}

function cleanComment(raw: string): string {
	return raw
		.replace(/^\/\//, '')
		.replace(/^\/\*/, '')
		.replace(/\*\/$/, '')
		.trim();
}

function isSameLine(source: ts.SourceFile, posA: number, posB: number): boolean {
	return source.getLineAndCharacterOfPosition(posA).line === source.getLineAndCharacterOfPosition(posB).line;
}

function getTrailingCommentText(node: ts.Node): string | undefined {
	const source = node.getSourceFile();
	const fullText = source.getFullText();
	const ranges = ts.getTrailingCommentRanges(fullText, node.end);
	if (!ranges || ranges.length === 0) return undefined;
	for (const range of ranges) {
		if (!isSameLine(source, node.end, range.pos)) continue;
		const text = cleanComment(fullText.slice(range.pos, range.end));
		if (text) return text;
	}
	return undefined;
}

function literalExpressionToValue(expr: ts.Expression): unknown {
	if (ts.isStringLiteralLike(expr)) return expr.text;
	if (ts.isNumericLiteral(expr)) return Number(expr.text);
	if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (expr.kind === ts.SyntaxKind.NullKeyword) return null;
	if (ts.isArrayLiteralExpression(expr)) {
		const arr: unknown[] = [];
		for (const el of expr.elements) {
			if (ts.isSpreadElement(el)) return undefined;
			const value = literalExpressionToValue(el as ts.Expression);
			if (value === undefined) return undefined;
			arr.push(value);
		}
		return arr;
	}
	if (ts.isObjectLiteralExpression(expr)) {
		const obj: Record<string, unknown> = {};
		for (const prop of expr.properties) {
			if (ts.isSpreadAssignment(prop)) return undefined;
			if (ts.isPropertyAssignment(prop) && prop.name) {
				const key = getPropertyName(prop.name);
				if (!key) return undefined;
				const value = literalExpressionToValue(prop.initializer);
				if (value === undefined) return undefined;
				obj[key] = value;
			} else if (ts.isShorthandPropertyAssignment(prop)) {
				return undefined;
			}
		}
		return obj;
	}
	if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expr.operand)) {
		return -Number(expr.operand.text);
	}
	if (ts.isTemplateExpression(expr)) {
		if (expr.templateSpans.length === 0) return expr.head.text;
	}
	if (ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
	return undefined;
}

function collectTypeDeclarations(filePaths: string[]): SchemaContext {
	const knownTypeNames = new Set<string>();
	const pending: Array<{ name: string; node: ts.TypeAliasDeclaration | ts.InterfaceDeclaration }> = [];

	for (const filePath of filePaths) {
		if (!fs.existsSync(filePath)) continue;
		const source = createSourceFile(filePath);
		source.forEachChild(node => {
			if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
				knownTypeNames.add(node.name.text);
				pending.push({ name: node.name.text, node });
			}
		});
	}

	const schemas: Record<string, OpenAPISchema> = {};
	const ctx: SchemaContext = { knownTypeNames, schemas };

	for (const entry of pending) {
		const schema = nodeToSchema(entry.node, ctx, new Set());
		if (schema) schemas[entry.name] = schema;
	}

	return ctx;
}

function nodeToSchema(
	node: ts.TypeAliasDeclaration | ts.InterfaceDeclaration,
	ctx: SchemaContext,
	seen: Set<string>,
): OpenAPISchema | undefined {
	if (ts.isTypeAliasDeclaration(node)) {
		return node.type ? typeNodeToSchema(node.type, ctx, seen) : undefined;
	}

	const baseSchemas: OpenAPISchema[] = [];
	if (node.heritageClauses) {
		for (const clause of node.heritageClauses) {
			for (const type of clause.types) {
				const typeName = type.expression.getText();
				if (ctx.knownTypeNames.has(typeName)) {
					baseSchemas.push({ $ref: `#/components/schemas/${typeName}` });
				}
			}
		}
	}

	const ownSchema = membersToSchema(node.members, ctx, seen);
	if (baseSchemas.length === 0) return ownSchema;
	return { allOf: [...baseSchemas, ownSchema] };
}

function membersToSchema(
	members: ts.NodeArray<ts.TypeElement>,
	ctx: SchemaContext,
	seen: Set<string>,
): OpenAPISchema {
	const properties: Record<string, OpenAPISchema> = {};
	const required = new Set<string>();

	for (const member of members) {
		if (!ts.isPropertySignature(member) || !member.name) continue;
		const propName = getPropertyName(member.name);
		if (!propName) continue;
		const schema = member.type ? typeNodeToSchema(member.type, ctx, seen) : {};
		const comment = getTrailingCommentText(member);
		if (comment) schema.description = comment;
		properties[propName] = schema;
		if (!member.questionToken) required.add(propName);
	}

	const result: OpenAPISchema = { type: 'object', properties };
	if (required.size > 0) result.required = Array.from(required);
	return result;
}

function getPropertyName(name: ts.PropertyName): string | undefined {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
	return undefined;
}

function typeNodeToSchema(typeNode: ts.TypeNode, ctx: SchemaContext, seen: Set<string>): OpenAPISchema {
	switch (typeNode.kind) {
		case ts.SyntaxKind.StringKeyword:
			return { type: 'string' };
		case ts.SyntaxKind.NumberKeyword:
			return { type: 'number' };
		case ts.SyntaxKind.BooleanKeyword:
			return { type: 'boolean' };
		case ts.SyntaxKind.AnyKeyword:
		case ts.SyntaxKind.UnknownKeyword:
			return {};
		case ts.SyntaxKind.VoidKeyword:
			return { type: 'null' };
		case ts.SyntaxKind.NullKeyword:
		case ts.SyntaxKind.UndefinedKeyword:
			return { type: 'null' };
		case ts.SyntaxKind.LiteralType: {
			const literal = typeNode as ts.LiteralTypeNode;
			if (ts.isStringLiteral(literal.literal)) return { type: 'string', enum: [literal.literal.text] };
			if (ts.isNumericLiteral(literal.literal)) return { type: 'number', enum: [Number(literal.literal.text)] };
			if (literal.literal.kind === ts.SyntaxKind.TrueKeyword || literal.literal.kind === ts.SyntaxKind.FalseKeyword) {
				return { type: 'boolean', enum: [literal.literal.kind === ts.SyntaxKind.TrueKeyword] };
			}
			return {};
		}
	}

	const cacheKey = typeNode.getText();
	if (seen.has(cacheKey)) return {};
	seen.add(cacheKey);

	switch (typeNode.kind) {
		case ts.SyntaxKind.ArrayType: {
			const arrayType = typeNode as ts.ArrayTypeNode;
			return { type: 'array', items: typeNodeToSchema(arrayType.elementType, ctx, seen) };
		}
		case ts.SyntaxKind.TupleType: {
			const tupleType = typeNode as ts.TupleTypeNode;
			return {
				type: 'array',
				prefixItems: tupleType.elements.map(el => typeNodeToSchema(el, ctx, seen)),
				items: false,
			};
		}
		case ts.SyntaxKind.TypeLiteral: {
			const literal = typeNode as ts.TypeLiteralNode;
			return membersToSchema(literal.members, ctx, seen);
		}
		case ts.SyntaxKind.ParenthesizedType:
			return typeNodeToSchema((typeNode as ts.ParenthesizedTypeNode).type, ctx, seen);
		case ts.SyntaxKind.TypeReference: {
			const ref = typeNode as ts.TypeReferenceNode;
			const name = ref.typeName.getText();
			if (name === 'Array' && ref.typeArguments?.[0]) {
				return { type: 'array', items: typeNodeToSchema(ref.typeArguments[0], ctx, seen) };
			}
			if (name === 'Promise' && ref.typeArguments?.[0]) {
				return typeNodeToSchema(ref.typeArguments[0], ctx, seen);
			}
			if (name === 'Record' && ref.typeArguments?.[1]) {
				return {
					type: 'object',
					additionalProperties: typeNodeToSchema(ref.typeArguments[1], ctx, seen),
				};
			}
			if (name === 'Readonly' && ref.typeArguments?.[0]) {
				return typeNodeToSchema(ref.typeArguments[0], ctx, seen);
			}
			if (ctx.knownTypeNames.has(name)) {
				return { $ref: `#/components/schemas/${name}` };
			}
			return { type: 'object' };
		}
		case ts.SyntaxKind.UnionType: {
			const union = typeNode as ts.UnionTypeNode;
			const nonNullish = union.types.filter(t => t.kind !== ts.SyntaxKind.UndefinedKeyword && t.kind !== ts.SyntaxKind.NullKeyword && t.kind !== ts.SyntaxKind.VoidKeyword);
			const hasNullish = nonNullish.length !== union.types.length;
			if (nonNullish.length === 1) {
				const schema = typeNodeToSchema(nonNullish[0], ctx, seen);
				if (hasNullish) return { ...schema, nullable: true };
				return schema;
			}
			return {
				oneOf: nonNullish.map(type => typeNodeToSchema(type, ctx, seen)),
				...(hasNullish ? { nullable: true } : {}),
			};
		}
		case ts.SyntaxKind.IntersectionType: {
			const intersection = typeNode as ts.IntersectionTypeNode;
			return {
				allOf: intersection.types.map(type => typeNodeToSchema(type, ctx, seen)),
			};
		}
		default:
			return {};
	}
}

function createSourceFile(filePath: string) {
	const sourceText = fs.readFileSync(filePath, 'utf8');
	return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function collectHttpEndpoints(ctx: SchemaContext): HttpEndpoint[] {
	if (!fs.existsSync(httpDir)) return [];
	const files = fs.readdirSync(httpDir).filter(f => f.endsWith('.ts') && f !== 'index.ts');
	const endpoints: HttpEndpoint[] = [];

	for (const file of files) {
		const filePath = path.join(httpDir, file);
		const source = createSourceFile(filePath);
		const tagName = createTagName(file);
		source.forEachChild(node => {
			if (ts.isVariableStatement(node) && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) {
				for (const decl of node.declarationList.declarations) {
					if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
					const callable = extractCallable(decl.initializer);
					if (!callable) continue;
					const { callExpression, method } = callable;
					if (!method) continue;
					const paramInfos = collectParamInfos(callable.parameters, ctx);
					const { path: urlPath, pathParams } = extractPath(callExpression.arguments[0], paramInfos, ctx);
					const requestBody = extractRequestBody(method, callExpression, paramInfos, ctx);
					const responseSchema = extractResponseSchema(callExpression, ctx);
					const summary = getJsDocSummary(decl) || formatSummary(decl.name.text);
					endpoints.push({
						name: decl.name.text,
						method,
						path: urlPath,
						summary,
						description: summary,
						pathParams,
						requestBody,
						responseSchema,
						tags: [tagName],
					});
				}
			}
		});
	}

	return endpoints;
}

function createTagName(filename: string): string {
	const base = filename.replace(/\.ts$/, '');
	return base
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[-_]/g, ' ')
		.replace(/\b\w/g, ch => ch.toUpperCase());
}

function formatSummary(name: string): string {
	const formatted = name
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.toLowerCase();
	return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function extractCallable(initializer: ts.Expression) {
	if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
		const callExpression = findApiCall(initializer.body);
		if (!callExpression) return undefined;
		const method = extractHttpMethod(callExpression);
		return { callExpression, method, parameters: initializer.parameters };
	}
	if (ts.isCallExpression(initializer)) {
		const method = extractHttpMethod(initializer);
		return method ? { callExpression: initializer, method, parameters: ts.factory.createNodeArray<ts.ParameterDeclaration>([]) } : undefined;
	}
	return undefined;
}

function findApiCall(body: ts.ConciseBody): ts.CallExpression | undefined {
	if (ts.isCallExpression(body)) return body;
	if (ts.isAwaitExpression(body) && ts.isCallExpression(body.expression)) return body.expression;
	if (ts.isBlock(body)) {
		for (const stmt of body.statements) {
			if (ts.isReturnStatement(stmt) && stmt.expression) {
				const result = findApiCall(stmt.expression as ts.ConciseBody);
				if (result) return result;
			}
			if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
				const method = extractHttpMethod(stmt.expression);
				if (method) return stmt.expression;
			}
		}
	}
	return undefined;
}

function extractHttpMethod(call: ts.CallExpression): string | undefined {
	if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
	const accessed = call.expression;
	if (accessed.expression.getText() !== 'api') return undefined;
	const methodName = accessed.name.text.toUpperCase();
	return methodName;
}

function collectParamInfos(params: ts.NodeArray<ts.ParameterDeclaration>, ctx: SchemaContext): Map<string, ParamInfo> {
	const map = new Map<string, ParamInfo>();
	for (const param of params) {
		if (!ts.isIdentifier(param.name)) continue;
		const { schema, description, defaultValue } = buildSchemaFromParam(param, ctx);
		map.set(param.name.text, {
			name: param.name.text,
			schema,
			typeNode: param.type,
			declaration: param,
			description,
			defaultValue,
		});
	}
	return map;
}

function buildSchemaFromParam(param: ts.ParameterDeclaration, ctx: SchemaContext) {
	const schema = param.type ? typeNodeToSchema(param.type, ctx, new Set()) : {};
	const defaultValue = param.initializer ? literalExpressionToValue(param.initializer) : undefined;
	if (defaultValue !== undefined) schema.default = defaultValue;
	const description = getTrailingCommentText(param);
	if (description) schema.description = description;
	return { schema, description, defaultValue };
}

function extractPath(
	expression: ts.Expression,
	params: Map<string, ParamInfo>,
	ctx: SchemaContext,
): { path: string; pathParams: PathParam[] } {
	const pathParams: PathParam[] = [];
	const appendParam = (placeholder: ResolvedPlaceholder) => {
		if (pathParams.some(param => param.name === placeholder.name)) return;
		const entry: PathParam = {
			name: placeholder.name,
			schema: cloneSchema(placeholder.schema),
			required: true,
		};
		if (placeholder.description) entry.description = placeholder.description;
		pathParams.push(entry);
	};

	if (ts.isStringLiteralLike(expression)) {
		return { path: ensureLeadingSlash(expression.text), pathParams };
	}

	if (ts.isTemplateExpression(expression)) {
		let pathText = expression.head.text;
		for (const span of expression.templateSpans) {
			const placeholder = resolvePlaceholder(span.expression, params, ctx);
			appendParam(placeholder);
			pathText += `{${placeholder.name}}` + span.literal.text;
		}
		return { path: ensureLeadingSlash(pathText), pathParams };
	}

	return { path: ensureLeadingSlash(expression.getText()), pathParams };
}

function resolvePlaceholder(
	expression: ts.Expression,
	params: Map<string, ParamInfo>,
	ctx: SchemaContext,
): ResolvedPlaceholder {
	if (ts.isIdentifier(expression)) {
		const param = params.get(expression.text);
		if (param) {
			return {
				name: expression.text,
				schema: cloneSchema(param.schema),
				description: param.description,
			};
		}
	}
	if (ts.isPropertyAccessExpression(expression)) {
		const base = expression.expression;
		const prop = expression.name.text;
		if (ts.isIdentifier(base)) {
			const param = params.get(base.text);
			if (param && param.typeNode && ts.isTypeReferenceNode(param.typeNode)) {
				const typeName = param.typeNode.typeName.getText();
				const typeSchema = ctx.schemas[typeName];
				if (typeSchema?.properties?.[prop]) {
					const propertySchema = cloneSchema(typeSchema.properties[prop]);
					return {
						name: combineNames(base.text, prop),
						schema: propertySchema,
						description: typeof typeSchema.properties[prop].description === 'string'
							? typeSchema.properties[prop].description
							: undefined,
					};
				}
			}
		}
		return {
			name: sanitizeName(expression.getText()),
			schema: {},
		};
	}
	return {
		name: sanitizeName(expression.getText()),
		schema: {},
	};
}

function ensureLeadingSlash(value: string): string {
	if (!value.startsWith('/')) return `/${value}`;
	return value;
}

function combineNames(base: string, prop: string): string {
	return base + prop.charAt(0).toUpperCase() + prop.slice(1);
}

function sanitizeName(raw: string): string {
	return raw.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'param';
}

function capitalize(value: string): string {
	if (!value) return value;
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeHttpUrl(value: string | undefined, fallback: string): string {
	if (!value) return fallback;
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	return `https://${trimmed.replace(/^\/+/, '')}`;
}

function normalizeWsUrl(value: string | undefined, fallback: string): string {
	if (!value) return fallback;
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	if (/^wss?:\/\//i.test(trimmed)) return trimmed;
	return `wss://${trimmed.replace(/^\/+/, '')}`;
}

function resolveSchemaRef(schema: OpenAPISchema, schemas: Record<string, OpenAPISchema>): OpenAPISchema {
	if (schema && typeof schema === 'object' && '$ref' in schema) {
		const ref = (schema as any).$ref;
		if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
			const key = ref.replace('#/components/schemas/', '');
			if (schemas[key]) return schemas[key];
		}
	}
	return schema;
}

function generateExampleFromSchema(schema: OpenAPISchema, schemas: Record<string, OpenAPISchema>, depth = 0): any {
	if (!schema) return undefined;
	const resolved = resolveSchemaRef(schema, schemas);
	if (!resolved || typeof resolved !== 'object') return undefined;
	if ((resolved as any).example !== undefined) return (resolved as any).example;
	if ((resolved as any).default !== undefined) return (resolved as any).default;
	const type = (resolved as any).type;
	if (type === 'object') {
		const result: Record<string, any> = {};
		const props = (resolved as any).properties ?? {};
		for (const key of Object.keys(props)) {
			result[key] = generateExampleFromSchema(props[key], schemas, depth + 1);
		}
		return result;
	}
	if (type === 'array') {
		const items = (resolved as any).items;
		const exampleItem = generateExampleFromSchema(items, schemas, depth + 1);
		return exampleItem !== undefined ? [exampleItem] : [];
	}
	if (type === 'string') return '';
	if (type === 'number' || type === 'integer') return 1;
	if (type === 'boolean') return false;
	return undefined;
}

function deepMergeExamples(base: any, override: any): any {
	if (override === undefined) return base;
	if (base === undefined) return override;
	if (Array.isArray(base) && Array.isArray(override)) return override.length > 0 ? override : base;
	if (typeof base === 'object' && base && typeof override === 'object' && override) {
		const result: Record<string, any> = { ...base };
		for (const key of Object.keys(override)) {
			result[key] = deepMergeExamples(base[key], override[key]);
		}
		return result;
	}
	return override;
}


function extractRequestBody(
	method: string,
	call: ts.CallExpression,
	params: Map<string, ParamInfo>,
	ctx: SchemaContext,
): { schema: OpenAPISchema; description?: string } | undefined {
	if (!['POST', 'PUT', 'PATCH'].includes(method)) return undefined;
	if (call.arguments.length < 2) return undefined;
	const bodyExpr = call.arguments[1];
	if (ts.isIdentifier(bodyExpr)) {
		const param = params.get(bodyExpr.text);
		if (param) {
			return {
				schema: cloneSchema(param.schema),
				description: param.description,
			};
		}
	}
	const schema = expressionToSchema(bodyExpr, params, ctx) ?? {};
	return { schema };
}

function expressionToSchema(
	expr: ts.Expression,
	params: Map<string, ParamInfo>,
	ctx: SchemaContext,
): OpenAPISchema | undefined {
	if (ts.isIdentifier(expr)) {
		const param = params.get(expr.text);
		return param ? cloneSchema(param.schema) : {};
	}
	if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
		const inner = ts.isAsExpression(expr) ? expr.expression : expr.expression;
		const typeNode = ts.isAsExpression(expr) ? expr.type : expr.type;
		const typeSchema = schemaFromTypeNode(typeNode, ctx);
		return typeSchema ?? expressionToSchema(inner, params, ctx) ?? {};
	}
	if (ts.isObjectLiteralExpression(expr)) {
		const properties: Record<string, OpenAPISchema> = {};
		const required = new Set<string>();
		for (const prop of expr.properties) {
			if (ts.isPropertyAssignment(prop) && prop.name) {
				const name = getPropertyName(prop.name);
				if (!name) continue;
				const valueSchema = expressionToSchema(prop.initializer, params, ctx) ?? {};
				const comment = getTrailingCommentText(prop);
				if (comment) valueSchema.description = comment;
				properties[name] = valueSchema;
				required.add(name);
			} else if (ts.isShorthandPropertyAssignment(prop)) {
				const name = prop.name.text;
				const param = params.get(name);
				const schema = param ? cloneSchema(param.schema) : {};
				const comment = getTrailingCommentText(prop);
				if (comment) schema.description = comment;
				properties[name] = schema;
				required.add(name);
			}
		}
		const schema: OpenAPISchema = { type: 'object', properties };
		if (required.size > 0) schema.required = Array.from(required);
		return schema;
	}
	if (ts.isArrayLiteralExpression(expr)) {
		const first = expr.elements[0];
		return {
			type: 'array',
			items: first ? expressionToSchema(first, params, ctx) ?? {} : {},
		};
	}
	if (ts.isStringLiteralLike(expr)) return { type: 'string', enum: [expr.text] };
	if (ts.isNumericLiteral(expr)) return { type: 'number', enum: [Number(expr.text)] };
	if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword) return { type: 'boolean', enum: [expr.kind === ts.SyntaxKind.TrueKeyword] };
	if (ts.isCallExpression(expr) && expr.typeArguments?.[0]) {
		return typeNodeToSchema(expr.typeArguments[0], ctx, new Set());
	}
	return {};
}

function extractResponseSchema(call: ts.CallExpression, ctx: SchemaContext): OpenAPISchema | undefined {
	if (call.typeArguments && call.typeArguments.length > 0) {
		return typeNodeToSchema(call.typeArguments[0], ctx, new Set());
	}
	return undefined;
}

function getJsDocSummary(node: ts.Node): string | undefined {
	const docs = ts.getJSDocCommentsAndTags(node);
	if (!docs || docs.length === 0) return undefined;
	const lines: string[] = [];
	for (const doc of docs) {
		if ('comment' in doc && typeof doc.comment === 'string') {
			lines.push(doc.comment.trim());
		}
	}
	return lines.join('\n').trim() || undefined;
}

function cloneSchema(schema: OpenAPISchema): OpenAPISchema {
	return JSON.parse(JSON.stringify(schema));
}

function buildHttpOpenApi(
	endpoints: HttpEndpoint[],
	schemas: Record<string, OpenAPISchema>,
	baseUrl: string,
) {
	const paths: Record<string, Record<string, any>> = {};
	for (const endpoint of endpoints) {
		const method = endpoint.method.toLowerCase();
		if (!paths[endpoint.path]) paths[endpoint.path] = {};
		const op: Record<string, any> = {
			operationId: endpoint.name,
			summary: endpoint.summary || formatSummary(endpoint.name),
			description: endpoint.description,
			parameters: endpoint.pathParams.map(param => ({
				name: param.name,
				in: 'path',
				required: param.required,
				schema: param.schema,
				...(param.description ? { description: param.description } : {}),
			})),
			responses: {
				'200': endpoint.responseSchema
					? {
						description: 'Successful response',
						content: {
							'application/json': {
								schema: endpoint.responseSchema,
							},
						},
					}
					: { description: 'Successful response' },
			},
		};
		if (!op.summary) op.summary = formatSummary(endpoint.name);
		if (!op.description) delete op.description;
		if (endpoint.requestBody) {
			op.requestBody = {
				required: true,
				description: endpoint.requestBody.description,
				content: {
					'application/json': {
						schema: endpoint.requestBody.schema,
					},
				},
			};
		}
		if (endpoint.tags.length > 0) op.tags = endpoint.tags;
		paths[endpoint.path][method] = op;
	}

	return {
		openapi: '3.1.0',
		info: {
			title: 'Betting API (HTTP)',
			version: '1.0.0',
		},
		servers: [
			{
				url: baseUrl,
			},
		],
		paths,
		components: {
			schemas,
		},
	};
}

function extractHttpBaseUrl(): string {
	const indexPath = path.join(httpDir, 'index.ts');
	if (!fs.existsSync(indexPath)) return 'https://api.example.com';
	const source = createSourceFile(indexPath);
	let baseUrl: string | undefined;
	source.forEachChild(node => {
		if (ts.isVariableStatement(node)) {
			for (const decl of node.declarationList.declarations) {
				if (!ts.isIdentifier(decl.name) || decl.name.text !== 'api' || !decl.initializer) continue;
				if (!ts.isNewExpression(decl.initializer)) continue;
				const newExpr = decl.initializer;
				if (newExpr.arguments && newExpr.arguments[0] && ts.isStringLiteralLike(newExpr.arguments[0])) {
					baseUrl = newExpr.arguments[0].text;
				}
			}
		}
	});
	return baseUrl || 'https://api.example.com';
}

function extractWsServerUrl(): string {
	const examplePath = path.join(socketDir, 'example.ts');
	if (!fs.existsSync(examplePath)) return 'wss://api.example.com/ws';
	const source = createSourceFile(examplePath);
	let serverUrl: string | undefined;
	source.forEachChild(function walk(node) {
		if (ts.isNewExpression(node) && node.expression.getText() === 'WSClient') {
			if (node.arguments && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
				serverUrl = node.arguments[0].text;
			}
		}
		ts.forEachChild(node, walk);
	});
	return serverUrl || 'wss://api.example.com/ws';
}

function collectWsArtifacts(ctx: SchemaContext): { events: WsEvent[]; publish?: WsPublish; outgoing: WsOutgoing[] } {
	const indexPath = path.join(socketDir, 'index.ts');
	const events: WsEvent[] = [];
	const outgoing: WsOutgoing[] = [];
	let publish: WsPublish | undefined;

	if (fs.existsSync(indexPath)) {
		const source = createSourceFile(indexPath);

		source.forEachChild(node => {
			if (ts.isClassDeclaration(node) && node.name?.text === 'WSClient') {
				const { classEvents, classPublish } = processWsClientClass(node, ctx);
				events.push(...classEvents);
				if (classPublish) publish = classPublish;
			} else if (ts.isFunctionDeclaration(node) && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) {
				const { fnEvents, fnOutgoing } = processWsFunction(node.name?.text, node.body, node.parameters, ctx, getJsDocSummary(node));
				events.push(...fnEvents);
				outgoing.push(...fnOutgoing);
			} else if (ts.isVariableStatement(node) && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) {
				for (const decl of node.declarationList.declarations) {
					if (!decl.initializer) continue;
					if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
						const { fnEvents, fnOutgoing } = processWsFunction(
							ts.isIdentifier(decl.name) ? decl.name.text : undefined,
							decl.initializer.body,
							decl.initializer.parameters,
							ctx,
							getJsDocSummary(decl),
						);
						events.push(...fnEvents);
						outgoing.push(...fnOutgoing);
					}
				}
			}
		});
	}

	// дополнительно просканируем остальные файлы на экспортируемые функции
	const otherFiles = fs
		.readdirSync(socketDir)
		.filter(f => f.endsWith('.ts') && f !== 'index.ts')
		.map(f => path.join(socketDir, f));

	for (const file of otherFiles) {
		const sourceFile = createSourceFile(file);
		sourceFile.forEachChild(node => {
			if (ts.isFunctionDeclaration(node) && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) {
				const { fnEvents, fnOutgoing } = processWsFunction(node.name?.text, node.body, node.parameters, ctx, getJsDocSummary(node));
				events.push(...fnEvents);
				outgoing.push(...fnOutgoing);
			} else if (ts.isVariableStatement(node) && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) {
				for (const decl of node.declarationList.declarations) {
					if (!decl.initializer) continue;
					if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
						const name = ts.isIdentifier(decl.name) ? decl.name.text : undefined;
						const { fnEvents, fnOutgoing } = processWsFunction(name, decl.initializer.body, decl.initializer.parameters, ctx, getJsDocSummary(decl));
						events.push(...fnEvents);
						outgoing.push(...fnOutgoing);
					}
				}
			}
		});
	}

	return { events, publish, outgoing };
}

function processWsFunction(
	name: string | undefined,
	body: ts.ConciseBody | undefined,
	parameters: ts.NodeArray<ts.ParameterDeclaration>,
	ctx: SchemaContext,
	comment?: string,
): { fnEvents: WsEvent[]; fnOutgoing: WsOutgoing[] } {
	const fnEvents: WsEvent[] = [];
	const fnOutgoing: WsOutgoing[] = [];
	if (!body) return { fnEvents, fnOutgoing };

	const block = ts.isBlock(body) ? body : undefined;
	if (block) {
		const dataIdentifiers = collectDataIdentifiers(block);
		ts.forEachChild(block, child => {
			if (ts.isSwitchStatement(child)) {
				const extracted = extractWsCases(child, dataIdentifiers, ctx);
				extracted.forEach(evt => {
					if (comment && !evt.description) evt.description = comment;
				});
				fnEvents.push(...extracted);
			}
		});
	}

	const paramsInfo = collectParamInfos(parameters, ctx);
	const sendMessages = extractWsSendMessages(body, paramsInfo, ctx, name, comment);
	fnOutgoing.push(...sendMessages);

	return { fnEvents, fnOutgoing };
}

function collectDataIdentifiers(body: ts.Block): Set<string> {
	const identifiers = new Set<string>(['data', 'msg']);
	for (const statement of body.statements) {
		if (ts.isVariableStatement(statement)) {
			for (const decl of statement.declarationList.declarations) {
				if (ts.isIdentifier(decl.name) && decl.initializer) {
					const initializerText = decl.initializer.getText();
					if (/msg\.(data|payload)/.test(initializerText)) {
						identifiers.add(decl.name.text);
					}
				}
			}
		}
	}
	return identifiers;
}

function extractWsCases(
	switchStatement: ts.SwitchStatement,
	dataIdentifiers: Set<string>,
	ctx: SchemaContext,
): WsEvent[] {
	const events: WsEvent[] = [];
	const baseMessageSchema = ctx.schemas['WSMessage'] ? cloneSchema(ctx.schemas['WSMessage']) : {
		type: 'object',
		properties: {
			action: { type: 'string' },
			data: {},
		},
		required: ['action'],
	};

	for (const clause of switchStatement.caseBlock.clauses) {
		if (!ts.isCaseClause(clause) || !clause.expression || !ts.isStringLiteral(clause.expression)) continue;
		const actionName = clause.expression.text;
		const payloadSchema = extractPayloadSchemaFromCase(clause, dataIdentifiers, ctx);
		const messageSchema = buildWsMessageSchema(baseMessageSchema, actionName, payloadSchema);
		events.push({
			name: actionName,
			schema: messageSchema,
			description: `Сообщение «${actionName}»` ,
			channel: `websocket/messages/${actionName}`,
		});
	}

	return events;
}

function extractPayloadSchemaFromCase(
	clause: ts.CaseClause,
	dataIdentifiers: Set<string>,
	ctx: SchemaContext,
): OpenAPISchema {
	let resolvedSchema: OpenAPISchema | undefined;

	const visit = (node: ts.Node) => {
		if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
			const expression = ts.isAsExpression(node) ? node.expression : node.expression;
			const typeNode = ts.isAsExpression(node) ? node.type : node.type;
			if (isReferencingData(expression, dataIdentifiers)) {
				const schema = schemaFromTypeNode(typeNode, ctx);
				if (schema) resolvedSchema = schema;
			}
		}
		ts.forEachChild(node, visit);
	};

	for (const statement of clause.statements) {
		visit(statement);
		if (resolvedSchema) break;
	}

	return resolvedSchema ?? {};
}

function schemaFromTypeNode(typeNode: ts.TypeNode, ctx: SchemaContext): OpenAPISchema | undefined {
	if (ts.isTypeReferenceNode(typeNode)) {
		const name = typeNode.typeName.getText();
		if (ctx.knownTypeNames.has(name)) {
			return { $ref: `#/components/schemas/${name}` };
		}
	}
	return typeNodeToSchema(typeNode, ctx, new Set());
}

function isReferencingData(expression: ts.Expression, identifiers: Set<string>): boolean {
	if (ts.isIdentifier(expression)) return identifiers.has(expression.text);
	if (ts.isPropertyAccessExpression(expression)) return isReferencingData(expression.expression, identifiers);
	if (ts.isParenthesizedExpression(expression)) return isReferencingData(expression.expression, identifiers);
	return false;
}

function buildWsMessageSchema(
	base: OpenAPISchema,
	actionName: string,
	payload: OpenAPISchema,
): OpenAPISchema {
	const schema = cloneSchema(base);
	if (!schema.type && schema.properties) schema.type = 'object';
	if (!schema.properties) schema.properties = {};

	if (!schema.properties.action) schema.properties.action = { type: 'string' };
	schema.properties.action = {
		...schema.properties.action,
		enum: [actionName],
	};

	if (!schema.properties.data) schema.properties.data = {};
	schema.properties.data = Object.keys(payload).length > 0 ? payload : schema.properties.data;

	if (!schema.required) schema.required = [];
	if (!schema.required.includes('action')) schema.required.push('action');
	if (Object.keys(payload).length > 0 && !schema.required.includes('data')) schema.required.push('data');

	return schema;
}

function extractWsSendMessages(
	body: ts.ConciseBody,
	params: Map<string, ParamInfo>,
	ctx: SchemaContext,
	fallbackName?: string,
	comment?: string,
): WsOutgoing[] {
	const messages: WsOutgoing[] = [];
	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.expression.text === 'ws' &&
			node.expression.name.text === 'send'
		) {
			const result = analyzeWsSendCall(node, params, ctx, fallbackName, comment);
			if (result) messages.push(result);
		}
		ts.forEachChild(node, visit);
	};

	if (ts.isBlock(body)) {
		body.statements.forEach(stmt => visit(stmt));
	} else {
		visit(body);
	}

	return messages;
}

function analyzeWsSendCall(
	call: ts.CallExpression,
	params: Map<string, ParamInfo>,
	ctx: SchemaContext,
	fallbackName?: string,
	comment?: string,
): WsOutgoing | undefined {
	const arg = call.arguments[0];
	const schema = arg ? expressionToSchema(arg, params, ctx) ?? {} : {};
	const actionName = arg ? extractActionName(arg) : undefined;
	const name = actionName || fallbackName || 'send';
	const finalSchema = ensureActionInSchema(cloneSchema(schema), actionName);
	const description = comment ? `${comment}` : `Отправка сообщения «${name}»`;
const example = buildWsExampleFromArgument(arg, params, ctx, finalSchema, actionName);
	if (example && actionName && typeof example === 'object' && !Array.isArray(example)) {
		example.action = example.action ?? actionName;
	}
	return {
		name,
		schema: finalSchema,
		description,
		channel: actionName ? `websocket/send/${actionName}` : `websocket/send/${name}`,
		example,
	};
}

function ensureActionInSchema(schema: OpenAPISchema, actionName?: string): OpenAPISchema {
	if (!actionName) return schema;
	if (!schema || typeof schema !== 'object') return schema;
	if (!schema.properties) schema.properties = {};
	schema.type = schema.type || 'object';
	schema.properties.action = {
		type: 'string',
		enum: [actionName],
	};
	if (!schema.required) schema.required = [];
	if (!schema.required.includes('action')) schema.required.push('action');
	return schema;
}

function extractActionName(expr: ts.Expression): string | undefined {
	if (ts.isObjectLiteralExpression(expr)) {
		for (const prop of expr.properties) {
			if (
				(ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) &&
				prop.name &&
				getPropertyName(prop.name) === 'action'
			) {
				if (ts.isPropertyAssignment(prop)) {
					const init = prop.initializer;
					if (ts.isStringLiteralLike(init)) return init.text;
					if (ts.isTemplateExpression(init) && init.templateSpans.length === 0) return init.head.text;
				}
				if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text;
			}
		}
	}
	return undefined;
}

function buildWsExampleFromArgument(
	arg: ts.Expression | undefined,
	params: Map<string, ParamInfo>,
	ctx: SchemaContext,
	schema: OpenAPISchema,
	actionName?: string,
) {
	if (!arg) return undefined;
	if (ts.isObjectLiteralExpression(arg)) return objectLiteralToExample(arg, params, ctx, schema, actionName);
	if (ts.isIdentifier(arg)) {
		const param = params.get(arg.text);
		return param?.defaultValue;
	}
	return undefined;
}

function objectLiteralToExample(
	node: ts.ObjectLiteralExpression,
	params: Map<string, ParamInfo>,
	ctx: SchemaContext,
	schema: OpenAPISchema,
	actionName?: string,
): any {
	const result: Record<string, any> = {};
	const properties = schema && typeof schema === 'object' && 'properties' in schema ? ((schema as any).properties ?? {}) : {};
	for (const prop of node.properties) {
		if (ts.isPropertyAssignment(prop) && prop.name) {
			const name = getPropertyName(prop.name);
			if (!name) continue;
			if (name === 'action' && actionName) {
				result[name] = actionName;
				continue;
			}
			const propertySchema = properties[name];
			const value = literalOrExpressionValue(prop.initializer, params, ctx, propertySchema);
			const fallback = generateExampleFromSchema(propertySchema, ctx.schemas);
			if (value !== undefined) result[name] = value;
			else if (fallback !== undefined) result[name] = fallback;
		} else if (ts.isShorthandPropertyAssignment(prop)) {
			const name = prop.name.text;
			const param = params.get(name);
			if (param?.defaultValue !== undefined) result[name] = param.defaultValue;
		}
	}
	return result;
}

function literalOrExpressionValue(
	expr: ts.Expression,
	params: Map<string, ParamInfo>,
	ctx: SchemaContext,
	schema?: OpenAPISchema,
) {
	if (ts.isStringLiteralLike(expr)) return expr.text;
	if (ts.isNumericLiteral(expr)) return Number(expr.text);
	if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (expr.kind === ts.SyntaxKind.NullKeyword) return null;
	if (ts.isIdentifier(expr)) {
		const param = params.get(expr.text);
		return param?.defaultValue;
	}
	if (ts.isObjectLiteralExpression(expr)) {
		return objectLiteralToExample(expr, params, ctx, schema ?? {}, undefined);
	}
	if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
		return literalOrExpressionValue(expr.expression, params, ctx, schema);
	}
	return undefined;
}

function processWsClientClass(node: ts.ClassDeclaration, ctx: SchemaContext) {
	const events: WsEvent[] = [];
	let publish: WsPublish | undefined;

	for (const member of node.members) {
		if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
			const methodName = member.name.text;
			if (methodName === 'connect' && member.body) {
				for (const stmt of member.body.statements) {
					if (!ts.isExpressionStatement(stmt) || !ts.isCallExpression(stmt.expression)) continue;
					const call = stmt.expression;
					if (!ts.isPropertyAccessExpression(call.expression)) continue;
					const outerAccess = call.expression;
					if (!ts.isPropertyAccessExpression(outerAccess.expression)) continue;
					const innerAccess = outerAccess.expression;
					if (innerAccess.expression.getText() !== 'this' || innerAccess.name.text !== 'ws') continue;
					if (outerAccess.name.text !== 'on') continue;
					const eventArg = call.arguments[0];
					const handlerArg = call.arguments[1];
					if (!eventArg || !ts.isStringLiteralLike(eventArg) || !handlerArg) continue;
					const eventName = eventArg.text;
					const schema = inferWsEventSchema(eventName, handlerArg, ctx);
					events.push({ name: eventName, schema });
				}
			}
			if (methodName === 'send' && member.parameters.length > 0) {
				const param = member.parameters[0];
				const { schema, description } = buildSchemaFromParam(param, ctx);
				publish = { schema, description };
			}
		}
	}

	return { classEvents: events, classPublish: publish };
}

function inferWsEventSchema(eventName: string, handler: ts.Expression, ctx: SchemaContext): OpenAPISchema {
	if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
		if (handler.parameters.length === 0) return { type: 'null' };
		if (handler.parameters.length === 1) {
			const param = handler.parameters[0];
			const inferred = inferSchemaFromParamName(param.name.getText());
			return inferred;
		}
		if (handler.parameters.length >= 2) {
			const first = handler.parameters[0];
			const second = handler.parameters[1];
			return {
				type: 'object',
				properties: {
					[first.name.getText()]: inferSchemaFromParamName(first.name.getText()),
					[second.name.getText()]: inferSchemaFromParamName(second.name.getText()),
				},
				required: [first.name.getText(), second.name.getText()],
			};
		}
	}
	switch (eventName) {
		case 'open':
			return { type: 'null' };
		case 'message':
			return { type: 'string' };
		case 'close':
			return {
				type: 'object',
				properties: {
					code: { type: 'number' },
					reason: { type: 'string' },
				},
				required: ['code', 'reason'],
			};
		default:
			return {};
	}
}

function inferSchemaFromParamName(name: string): OpenAPISchema {
	if (/code/i.test(name)) return { type: 'number' };
	if (/reason/i.test(name)) return { type: 'string' };
	if (/err/i.test(name) || /error/i.test(name)) return { type: 'string' };
	if (/msg|data|payload/i.test(name)) return { type: 'string' };
	return {};
}

function buildWsOpenApi(
	events: WsEvent[],
	publish: WsPublish | undefined,
	outgoing: WsOutgoing[],
	schemas: Record<string, OpenAPISchema>,
	serverUrl: string,
) {
	const paths: Record<string, Record<string, any>> = {};

	const ensurePath = (pathName: string) => {
		if (!paths[pathName]) paths[pathName] = {};
		return paths[pathName];
	};

	for (const event of events) {
		const op = ensurePath(`/ws/messages/${event.name}`);
		op.get = {
			tags: ['WebSocket Events'],
			summary: event.description || `Сообщение «${event.name}»`,
			description: event.description,
			operationId: `on${capitalize(event.name)}`,
			responses: {},
			'x-hideTryItPanel': true,
		};
	}

	const outgoingMessages = publish && !outgoing.length
		? [...outgoing, { name: 'send', schema: publish.schema, description: publish.description, channel: 'send' }]
		: outgoing;

	for (const message of outgoingMessages) {
		const pathName = `/ws/send/${message.name}`;
		const op = ensurePath(pathName);
		const examplePayload = buildWsPayloadExample(message, schemas);
		op.post = {
			tags: ['WebSocket Send'],
			summary: message.description || `Отправка сообщения «${message.name}»`,
			operationId: `send${capitalize(message.name)}`,
			description: message.description || `Отправка сообщения «${message.name}»`,
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: message.schema,
						...(examplePayload ? { example: examplePayload } : {}),
					},
				},
			},
			responses: {},
			'x-codeSamples': [
				{
					lang: 'WebSocket',
					label: 'WebSocket',
					source: buildWsCodeSample(examplePayload ?? { action: message.name }),
				},
			],
			'x-codeSamplesLock': true,
		};
	}

	return {
		openapi: '3.1.0',
		info: {
			title: 'Betting API (WebSocket)',
			version: '1.0.0',
			description: 'Документация действий WebSocket клиента/сервера, сгенерированная автоматически из исходного кода.',
		},
		servers: [
			{
				url: serverUrl,
				description: 'Основное WebSocket подключение',
			},
		],
		paths,
		components: { schemas },
	};
}

function buildWsPayloadExample(message: WsOutgoing, schemas: Record<string, OpenAPISchema>) {
	const base = generateExampleFromSchema(message.schema, schemas);
	if (!message.example) return base;
	return deepMergeExamples(base, message.example);
}

function buildWsCodeSample(payload: any): string {
	const json = JSON.stringify(payload, null, 2);
	return `ws.send(${json});`;
}
