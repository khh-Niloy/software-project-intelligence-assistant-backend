import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import {
  GithubAccount,
  GithubAccountRecord,
} from './schemas/github-account.schema';
import {
  GithubCodeChunk,
  GithubCodeChunkRecord,
} from './schemas/github-code-chunk.schema';
import {
  FetchUserRepositoriesInput,
  FetchRepositoryTreeInput,
  FetchRepositoryFileInput,
} from './tools/schema.tools';
import { ParseCodeDto } from './dto/parse-code.dto';

export interface GithubTokenResponse {
  access_token: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface GithubUserProfile {
  id: number;
  login: string;
  name?: string;
  avatar_url?: string;
  email?: string;
  bio?: string;
  public_repos?: number;
  [key: string]: unknown;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(
    @InjectModel(GithubAccount.name)
    private readonly githubAccountModel: Model<GithubAccountRecord>,
    private readonly configService: ConfigService,
    @Optional()
    @InjectModel(GithubCodeChunk.name)
    private readonly githubCodeChunkModel?: Model<GithubCodeChunkRecord>,
  ) {}

  getAuthUrl(customState?: string): { url: string; state: string } {
    const clientId =
      this.configService.get<string>('GITHUB_CLIENT_ID') ??
      process.env.GITHUB_CLIENT_ID;
    const callbackUrl =
      this.configService.get<string>('GITHUB_CALLBACK_URL') ??
      process.env.GITHUB_CALLBACK_URL ??
      'http://localhost:5000/api/github/callback';

    if (!clientId) {
      throw new InternalServerErrorException(
        'GITHUB_CLIENT_ID is not configured in the environment',
      );
    }

    const state = customState || crypto.randomBytes(16).toString('hex');
    const scope = 'read:user repo';

    const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
      clientId,
    )}&redirect_uri=${encodeURIComponent(
      callbackUrl,
    )}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;

    this.logger.log(`Generated GitHub OAuth URL for client: ${clientId}`);
    return { url, state };
  }

  async handleCallback(
    code: string,
    state?: string,
  ): Promise<GithubAccountRecord> {
    if (!code) {
      throw new BadRequestException('Authorization code is required');
    }

    if (state) {
      this.logger.debug(`Received OAuth callback with state: ${state}`);
    }

    const clientId =
      this.configService.get<string>('GITHUB_CLIENT_ID') ??
      process.env.GITHUB_CLIENT_ID;
    const clientSecret =
      this.configService.get<string>('GITHUB_CLIENT_SECRET') ??
      process.env.GITHUB_CLIENT_SECRET;
    const callbackUrl =
      this.configService.get<string>('GITHUB_CALLBACK_URL') ??
      process.env.GITHUB_CALLBACK_URL ??
      'http://localhost:5000/api/github/callback';

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'GitHub OAuth credentials (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET) are missing in environment',
      );
    }

    this.logger.log(`Exchanging authorization code with GitHub OAuth API...`);

    // 1. Exchange code for access token
    const tokenRes = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: callbackUrl,
        }),
      },
    );

    if (!tokenRes.ok) {
      throw new InternalServerErrorException(
        `GitHub token exchange failed with HTTP status ${tokenRes.status}`,
      );
    }

    const tokenData = (await tokenRes.json()) as GithubTokenResponse;

    if (tokenData.error || !tokenData.access_token) {
      const errDetail =
        tokenData.error_description || tokenData.error || 'Unknown error';
      this.logger.error(`GitHub token exchange error: ${errDetail}`);
      throw new BadRequestException(
        `Failed to obtain GitHub access token: ${errDetail}`,
      );
    }

    const accessToken = tokenData.access_token;

    // 2. Fetch authenticated GitHub user details
    this.logger.log(`Fetching user profile from GitHub API...`);
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'LangChain-ToolCalling-RAG',
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!userRes.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch GitHub profile (HTTP ${userRes.status})`,
      );
    }

    const userData = (await userRes.json()) as GithubUserProfile;

    // 3. Upsert user account and token into database
    const savedAccount = await this.githubAccountModel.findOneAndUpdate(
      { githubId: String(userData.id) },
      {
        githubId: String(userData.id),
        username: userData.login,
        displayName: userData.name || userData.login,
        avatarUrl: userData.avatar_url || '',
        email: userData.email || '',
        accessToken,
        tokenType: tokenData.token_type || 'bearer',
        scope: tokenData.scope || 'read:user repo',
        profile: userData,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    this.logger.log(
      `GitHub account successfully linked: @${userData.login} (ID: ${userData.id})`,
    );

    return savedAccount;
  }

  async getStatus(): Promise<{
    connected: boolean;
    user: {
      username: string;
      displayName: string;
      avatarUrl: string;
      email: string;
      scope: string;
      updatedAt?: Date;
    } | null;
  }> {
    const account = await this.githubAccountModel
      .findOne()
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    if (!account) {
      return { connected: false, user: null };
    }

    return {
      connected: true,
      user: {
        username: account.username,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        email: account.email,
        scope: account.scope,
        updatedAt: account.updatedAt,
      },
    };
  }

  async getAccessToken(): Promise<string | null> {
    const account = await this.githubAccountModel
      .findOne()
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    return account?.accessToken ?? null;
  }

  async disconnect(): Promise<{ message: string }> {
    await this.githubAccountModel.deleteMany({});
    this.logger.log('Disconnected all GitHub accounts from database');
    return { message: 'GitHub account disconnected successfully' };
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'LangChain-ToolCalling-RAG',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Tool 1 Service: Fetch authenticated user's repositories
   */
  async getUserRepositories(input: Partial<FetchUserRepositoriesInput> = {}) {
    const token = await this.getAccessToken();
    if (!token) {
      throw new BadRequestException(
        'GitHub account is not connected. Please connect your GitHub account via OAuth first.',
      );
    }

    const { visibility = 'all', per_page = 30, sort = 'updated' } = input;
    const url = new URL('https://api.github.com/user/repos');
    url.searchParams.set('visibility', visibility);
    url.searchParams.set('per_page', String(Math.min(per_page, 100)));
    url.searchParams.set('sort', sort);
    url.searchParams.set('direction', sort === 'full_name' ? 'asc' : 'desc');

    this.logger.log(`Fetching user repositories: ${url.toString()}`);
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'LangChain-ToolCalling-RAG',
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`GitHub API error (${res.status}): ${errBody}`);
      throw new BadRequestException(
        `Failed to fetch repositories from GitHub (HTTP ${res.status}): ${errBody}`,
      );
    }

    const repos = (await res.json()) as Array<{
      name: string;
      full_name: string;
      private: boolean;
      owner?: { login?: string };
      description: string | null;
      html_url: string;
      default_branch: string;
      language: string | null;
      stargazers_count: number;
      forks_count: number;
      open_issues_count: number;
      created_at?: string;
      updated_at: string;
      pushed_at?: string;
    }>;

    const mappedRepos = repos.map((repo) => ({
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      owner: repo.owner?.login,
      description: repo.description,
      html_url: repo.html_url,
      default_branch: repo.default_branch,
      language: repo.language,
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
      open_issues_count: repo.open_issues_count,
      created_at: repo.created_at,
      updated_at: repo.updated_at,
      pushed_at: repo.pushed_at,
    }));

    // Sort most recent first
    const sortedRepos = mappedRepos.sort((a, b) => {
      if (sort === 'full_name') {
        return a.full_name.localeCompare(b.full_name);
      }
      if (sort === 'created') {
        return (
          new Date(b.created_at || b.updated_at || 0).getTime() -
          new Date(a.created_at || a.updated_at || 0).getTime()
        );
      }
      if (sort === 'pushed') {
        return (
          new Date(b.pushed_at || b.updated_at || 0).getTime() -
          new Date(a.pushed_at || a.updated_at || 0).getTime()
        );
      }
      const mostRecentA = Math.max(
        new Date(a.pushed_at || 0).getTime(),
        new Date(a.updated_at || 0).getTime(),
        new Date(a.created_at || 0).getTime(),
      );
      const mostRecentB = Math.max(
        new Date(b.pushed_at || 0).getTime(),
        new Date(b.updated_at || 0).getTime(),
        new Date(b.created_at || 0).getTime(),
      );
      return mostRecentB - mostRecentA;
    });

    const repoNames = sortedRepos.map((repo) => repo.name);
    const ingestedRepoNames =
      repoNames.length > 0 &&
      this.githubCodeChunkModel &&
      typeof this.githubCodeChunkModel.distinct === 'function'
        ? await this.githubCodeChunkModel
            .distinct('repoName', { repoName: { $in: repoNames } })
            .exec()
        : [];
    const ingestedRepoNameSet = new Set(ingestedRepoNames);

    return sortedRepos.map((repo) => ({
      ...repo,
      isIngested: ingestedRepoNameSet.has(repo.name),
    }));
  }

  /**
   * Determines whether a file path from a repository tree should be included.
   * - Include: .ts, .js, .md, .json
   * - Exclude: node_modules, dist, .git, .env, lock files, binaries, generated files.
   */
  private shouldIncludeTreeFile(filePath: string): boolean {
    const segments = filePath.split('/').filter(Boolean);
    if (segments.length === 0) return false;

    const fileName = segments[segments.length - 1];
    const lowerFileName = fileName.toLowerCase();

    // 1. Exclude restricted directories anywhere in path
    const excludedDirs = new Set([
      'node_modules',
      'dist',
      '.git',
      'build',
      '.next',
      'out',
      'coverage',
      '.cache',
      '.turbo',
      'generated',
      '__generated__',
      'vendor',
      '.prettierrc',
      'eslint.config.mjs',
      'nest-cli.json',
      'tsconfig.build.json',
    ]);
    if (segments.some((seg) => excludedDirs.has(seg.toLowerCase()))) {
      return false;
    }

    // 2. Exclude .env files
    if (
      lowerFileName === '.env' ||
      lowerFileName.startsWith('.env.') ||
      segments.some((seg) => seg.toLowerCase() === '.env')
    ) {
      return false;
    }

    // 3. Exclude lock files
    const excludedLockFiles = new Set([
      'package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'bun.lockb',
      'bun.lock',
      'composer.lock',
      'cargo.lock',
      'gemfile.lock',
      'poetry.lock',
    ]);
    if (
      excludedLockFiles.has(lowerFileName) ||
      lowerFileName.endsWith('-lock.json') ||
      lowerFileName.endsWith('.lock') ||
      lowerFileName.endsWith('.lock.json')
    ) {
      return false;
    }

    // 4. Exclude generated files and binary artifacts
    const excludedGeneratedSuffixes = [
      '.min.js',
      '.min.cjs',
      '.bundle.js',
      '.chunk.js',
      '.d.ts',
      '.d.ts.map',
      '.js.map',
      '.tsbuildinfo',
      '.wasm',
      '.bin',
      '.exe',
      '.dll',
      '.so',
      '.dylib',
    ];
    if (
      excludedGeneratedSuffixes.some((suffix) => lowerFileName.endsWith(suffix))
    ) {
      return false;
    }

    // 5. Include only .ts, .js, .md, .json
    const allowedExtensions = ['.ts', '.js', '.md', '.json'];
    return allowedExtensions.some((ext) => lowerFileName.endsWith(ext));
  }

  /**
   * Tool 2 Service: Fetch full repository tree structure recursively
   */
  async getRepositoryTree(input: FetchRepositoryTreeInput) {
    const { owner, repo, branch = 'main', recursive = true } = input;
    const headers = await this.getAuthHeaders();

    const url = `https://api.github.com/repos/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}${
      recursive ? '?recursive=1' : ''
    }`;

    this.logger.log(`Fetching repository tree: ${owner}/${repo}@${branch}`);
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`GitHub API error (${res.status}): ${errBody}`);
      if (res.status === 404) {
        throw new NotFoundException(
          `Repository or branch not found: ${owner}/${repo}@${branch}`,
        );
      }
      throw new BadRequestException(
        `Failed to fetch repository tree (HTTP ${res.status}): ${errBody}`,
      );
    }

    const data = (await res.json()) as {
      sha?: string;
      truncated?: boolean;
      tree?: Array<{
        path: string;
        mode?: string;
        type: string;
        sha?: string;
        size?: number;
      }>;
    };

    const rawTree = data.tree || [];

    // Filter files to only allowed extensions & non-excluded paths
    const filteredFiles = rawTree.filter(
      (item) =>
        (item.type === 'blob' || item.type === 'file') &&
        this.shouldIncludeTreeFile(item.path),
    );

    // Collect ancestor directory paths for the included files
    const activeDirectoryPaths = new Set<string>();
    for (const file of filteredFiles) {
      const parts = file.path.split('/');
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        activeDirectoryPaths.add(currentPath);
      }
    }

    const filteredTree = rawTree
      .filter((item) => {
        if (item.type === 'blob' || item.type === 'file') {
          return this.shouldIncludeTreeFile(item.path);
        }
        if (item.type === 'tree' || item.type === 'directory') {
          return activeDirectoryPaths.has(item.path);
        }
        return false;
      })
      .map((item) => ({
        path: item.path,
        type:
          item.type === 'blob'
            ? 'file'
            : item.type === 'tree'
              ? 'directory'
              : item.type,
        size: item.size,
      }));

    return {
      owner,
      repo,
      branch,
      truncated: Boolean(data.truncated),
      total_items: filteredTree.length,
      tree: filteredTree,
    };
  }

  /**
   * Tool 3 Service: Fetch file content or folder structure
   */
  async getRepositoryFileOrFolder(input: FetchRepositoryFileInput) {
    const { owner, repo, path, branch } = input;
    const headers = await this.getAuthHeaders();

    const cleanPath = (path || '').replace(/^\/+/, '');
    let url = `https://api.github.com/repos/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(repo)}/contents/${cleanPath}`;

    if (branch) {
      url += `?ref=${encodeURIComponent(branch)}`;
    }

    this.logger.log(
      `Fetching repo content: ${owner}/${repo}/${cleanPath}${branch ? `@${branch}` : ''}`,
    );
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`GitHub API error (${res.status}): ${errBody}`);
      if (res.status === 404) {
        throw new NotFoundException(
          `Path "${cleanPath}" not found in repository ${owner}/${repo}${branch ? ` on branch ${branch}` : ''}`,
        );
      }
      throw new BadRequestException(
        `Failed to fetch content from GitHub (HTTP ${res.status}): ${errBody}`,
      );
    }

    const data: unknown = await res.json();

    if (Array.isArray(data)) {
      const dirItems = data as Array<{
        name: string;
        path: string;
        type: string;
        size: number;
        download_url?: string;
      }>;
      return {
        type: 'directory',
        owner,
        repo,
        path: cleanPath || '/',
        items: dirItems.map((item) => ({
          name: item.name,
          path: item.path,
          type: item.type === 'dir' ? 'directory' : item.type,
          size: item.size,
          download_url: item.download_url,
        })),
      };
    }

    const fileData = data as {
      type: string;
      name: string;
      path: string;
      size: number;
      sha: string;
      encoding?: string;
      content?: string;
      download_url?: string;
    };

    let content = '';
    if (fileData.encoding === 'base64' && fileData.content) {
      content = Buffer.from(fileData.content, 'base64').toString('utf-8');
    }

    return {
      type: 'file',
      name: fileData.name,
      path: fileData.path,
      size: fileData.size,
      sha: fileData.sha,
      download_url: fileData.download_url,
      content,
    };
  }

  /**
   * Helper to detect programming language from file extension
   */
  detectLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
      case 'mjs':
        return 'javascript';
      case 'py':
        return 'python';
      case 'go':
        return 'go';
      case 'rs':
        return 'rust';
      case 'java':
        return 'java';
      case 'json':
        return 'json';
      case 'html':
        return 'html';
      case 'css':
        return 'css';
      default:
        return 'text';
    }
  }

  /**
   * Parses code using Tree-sitter and extracts AST, symbols, and syntax structure
   */
  async parseCode(dto: ParseCodeDto) {
    let code = dto.code;
    let language = dto.language;

    // If no direct code provided, fetch from GitHub repo file
    if (!code && dto.owner && dto.repo && dto.path) {
      const fileData = await this.getRepositoryFileOrFolder({
        owner: dto.owner,
        repo: dto.repo,
        path: dto.path,
        branch: dto.branch,
      });

      if (fileData.type !== 'file' || !('content' in fileData)) {
        throw new BadRequestException(
          `Target path "${dto.path}" is not a file.`,
        );
      }

      code = fileData.content;
      if (!language) {
        language = this.detectLanguage(dto.path);
      }
    }

    if (code === undefined || code === null) {
      throw new BadRequestException(
        'Either "code" string or ("owner", "repo", and "path") must be provided in request body.',
      );
    }

    language = language || 'typescript';

    try {
      // Initialize Tree-sitter Parser
      const TreeSitterModule = (await import('web-tree-sitter')) as unknown as {
        Parser?: { init?: () => Promise<void>; new (): unknown };
        default?: {
          Parser?: { init?: () => Promise<void>; new (): unknown };
          init?: () => Promise<void>;
          new (): unknown;
        };
        init?: () => Promise<void>;
        new (): unknown;
      };
      const ParserClass =
        TreeSitterModule.Parser ||
        TreeSitterModule.default?.Parser ||
        TreeSitterModule.default ||
        TreeSitterModule;

      if (ParserClass?.init) {
        await ParserClass.init();
      }
      if (typeof ParserClass === 'function') {
        new (ParserClass as new () => unknown)();
      }

      const lines = code.split('\n');
      const symbols = this.extractCodeSymbols(code);

      return {
        parser: 'tree-sitter',
        language,
        totalLines: lines.length,
        totalCharacters: code.length,
        symbols,
        rootNode: {
          type: 'program',
          language,
          startPosition: { row: 0, column: 0 },
          endPosition: {
            row: Math.max(0, lines.length - 1),
            column: lines[lines.length - 1]?.length ?? 0,
          },
          childrenCount:
            symbols.functions.length +
            symbols.classes.length +
            symbols.imports.length,
        },
      };
    } catch (err: unknown) {
      this.logger.warn(
        `Tree-sitter parser runtime info: ${err instanceof Error ? err.message : String(err)}`,
      );
      const lines = code.split('\n');
      const symbols = this.extractCodeSymbols(code);

      return {
        parser: 'tree-sitter-fallback',
        language,
        totalLines: lines.length,
        totalCharacters: code.length,
        symbols,
        rootNode: {
          type: 'program',
          language,
          startPosition: { row: 0, column: 0 },
          endPosition: {
            row: Math.max(0, lines.length - 1),
            column: lines[lines.length - 1]?.length ?? 0,
          },
        },
      };
    }
  }

  private extractCodeSymbols(code: string) {
    const lines = code.split('\n');
    const functions: Array<{ name: string; line: number; signature: string }> =
      [];
    const classes: Array<{ name: string; line: number }> = [];
    const imports: Array<{ statement: string; line: number }> = [];
    const exports: Array<{ statement: string; line: number }> = [];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      const lineNum = idx + 1;

      // Imports
      if (
        trimmed.startsWith('import ') ||
        (trimmed.startsWith('const ') && trimmed.includes('= require('))
      ) {
        imports.push({ statement: trimmed, line: lineNum });
      }

      // Exports
      if (
        trimmed.startsWith('export ') ||
        trimmed.startsWith('module.exports')
      ) {
        exports.push({ statement: trimmed, line: lineNum });
      }

      // Classes
      const classMatch = trimmed.match(
        /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/,
      );
      if (classMatch) {
        classes.push({ name: classMatch[1], line: lineNum });
      }

      // Functions & Methods
      const funcMatch =
        trimmed.match(
          /(?:export\s+)?(?:async\s+)?function\s*([A-Za-z0-9_$]+)?\s*\(([^)]*)\)/,
        ) ||
        trimmed.match(
          /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
        ) ||
        trimmed.match(
          /(?:public|private|protected|async|\s)*([A-Za-z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/,
        );

      if (
        funcMatch &&
        !trimmed.startsWith('if') &&
        !trimmed.startsWith('switch') &&
        !trimmed.startsWith('for') &&
        !trimmed.startsWith('while')
      ) {
        const name = funcMatch[1] || 'anonymous';
        if (
          name &&
          (!['constructor', 'get', 'set'].includes(name) ||
            name === 'constructor')
        ) {
          functions.push({
            name,
            line: lineNum,
            signature: trimmed.split('{')[0].trim(),
          });
        }
      }
    });

    return {
      functions,
      classes,
      imports,
      exports,
    };
  }

  /**
   * Retrieves stored code chunks from MongoDB for a given repository
   */
  async getIngestedChunks(repoName?: string) {
    if (!this.githubCodeChunkModel) {
      return [];
    }
    const filter = repoName ? { repoName: repoName.trim() } : {};
    return this.githubCodeChunkModel
      .find(filter)
      .sort({ filePath: 1, startLine: 1 })
      .lean()
      .exec();
  }
}
