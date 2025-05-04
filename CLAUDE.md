# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
- TypeScript helper class called `Container` that wraps PartyKit durable objects
- Provides abstraction layer to hide durable object implementation details
- Similar to Cloudflare's Agents SDK: https://github.com/cloudflare/agents

## Build/Test/Lint Commands
- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Test: `npm test`
- Test single: `npm test -- -t "test name"`
- Lint: `npm run lint`
- TypeCheck: `npm run typecheck`
- Deploy: `npm run deploy`

## Code Style Guidelines
- **Formatting**: Use Prettier with default configuration
- **Imports**: Group by built-in, third-party, then local; alphabetize within groups
- **Types**: Strong typing, prefer interfaces for public APIs, types for internals
- **Naming**: PascalCase for classes/interfaces, camelCase for variables/functions
- **Error Handling**: Use async/await with try/catch, provide meaningful error messages
- **Documentation**: JSDoc for all public methods and classes
- **Exports**: Named exports preferred over default exports
- **State Management**: Implement clean serialization/deserialization for durable persistence
- **Patterns**: Use decorator pattern for method exposure when appropriate
- **Whitespace**: Remove trailing whitespace
