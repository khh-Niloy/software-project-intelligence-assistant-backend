import { CodeChunker } from './code-chunker.util';

describe('CodeChunker', () => {
  it('should keep a small file (<= 600 chars) as a single chunk with accurate metadata', () => {
    const code = [
      'export class AuthService {',
      '  async login() {',
      '    return true;',
      '  }',
      '}',
    ].join('\n');

    const chunks = CodeChunker.chunkFileContent({
      repoName: 'my-repo',
      filePath: 'src/auth/auth.service.ts',
      language: 'typescript',
      content: code,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      repoName: 'my-repo',
      filePath: 'src/auth/auth.service.ts',
      language: 'typescript',
      className: 'AuthService',
      functionName: 'login',
      startLine: 1,
      endLine: 5,
      content: code,
    });
  });

  it('should split a larger TypeScript class file (> 600 chars) into logical method chunks', () => {
    const code = [
      "import { Injectable } from '@nestjs/common';",
      "import { UsersService } from '../users/users.service';",
      '',
      '@Injectable()',
      'export class AuthService {',
      '  constructor(private readonly usersService: UsersService) {}',
      '',
      '  async login(email: string, pass: string) {',
      '    const user = await this.usersService.findByEmail(email);',
      '    if (!user || user.password !== pass) {',
      "      throw new Error('Invalid credentials provided by user');",
      '    }',
      '    return { token: "jwt_token_value", userId: user.id };',
      '  }',
      '',
      '  async register(email: string, pass: string, name: string) {',
      '    const existing = await this.usersService.findByEmail(email);',
      '    if (existing) {',
      "      throw new Error('User with this email already exists in database');",
      '    }',
      '    const created = await this.usersService.create({ email, pass, name });',
      '    return { id: created.id, email: created.email, status: "active" };',
      '  }',
      '}',
    ].join('\n');

    expect(code.length).toBeGreaterThan(600);

    const chunks = CodeChunker.chunkFileContent({
      repoName: 'my-repo',
      filePath: 'src/auth/auth.service.ts',
      language: 'typescript',
      content: code,
    });

    const loginChunk = chunks.find((c) => c.functionName === 'login');
    const registerChunk = chunks.find((c) => c.functionName === 'register');

    expect(loginChunk).toBeDefined();
    expect(loginChunk?.className).toBe('AuthService');
    expect(loginChunk?.startLine).toBe(8);
    expect(loginChunk?.endLine).toBe(14);
    expect(loginChunk?.content).toContain('async login(email: string');

    expect(registerChunk).toBeDefined();
    expect(registerChunk?.className).toBe('AuthService');
    expect(registerChunk?.startLine).toBe(16);
    expect(registerChunk?.endLine).toBe(23);
    expect(registerChunk?.content).toContain('async register(email: string');
  });

  it('should sub-divide an oversized function (> 2000 chars) into smaller sub-chunks with line-aligned overlap', () => {
    const bodyLines: string[] = [];
    for (let i = 1; i <= 50; i++) {
      bodyLines.push(
        `    const stepResult${i} = await this.processStep(${i}, "payload_data_string_value_${i}");`,
      );
    }

    const code = [
      'export class HeavyProcessor {',
      '  async runPipeline() {',
      ...bodyLines,
      '    return true;',
      '  }',
      '}',
    ].join('\n');

    expect(code.length).toBeGreaterThan(2000);

    const chunks = CodeChunker.chunkFileContent({
      repoName: 'my-repo',
      filePath: 'src/processor.ts',
      language: 'typescript',
      content: code,
    });

    const pipelineSubChunks = chunks.filter(
      (c) => c.functionName === 'runPipeline',
    );
    expect(pipelineSubChunks.length).toBeGreaterThan(1);

    // Check line-aligned overlap: Sub-chunk 2 startLine should be <= Sub-chunk 1 endLine
    const first = pipelineSubChunks[0];
    const second = pipelineSubChunks[1];
    expect(first.className).toBe('HeavyProcessor');
    expect(second.className).toBe('HeavyProcessor');
    expect(second.startLine).toBeLessThanOrEqual(first.endLine);
    expect(second.startLine).toBeGreaterThan(first.startLine);
  });
});
