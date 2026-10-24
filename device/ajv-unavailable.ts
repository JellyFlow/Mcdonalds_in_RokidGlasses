// SDK fallback must never dynamically compile schemas inside Ink.
export class AjvJsonSchemaValidator {getValidator(){throw new Error('Use precompiled MCP validators.');}}
