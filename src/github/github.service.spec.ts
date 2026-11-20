import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { GithubService } from './github.service';
import { GithubAccount } from './schemas/github-account.schema';
import { GithubCodeChunk } from './schemas/github-code-chunk.schema';

describe('GithubService', () => {
  let service: GithubService;

  const mockGithubAccountModel = {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };

  const mockGithubCodeChunkModel = {
    find: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'GITHUB_CLIENT_ID') return 'mock_client_id';
      if (key === 'GITHUB_CLIENT_SECRET') return 'mock_client_secret';
      if (key === 'GITHUB_CALLBACK_URL')
        return 'http://localhost:5000/api/github/callback';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubService,
        {
          provide: getModelToken(GithubAccount.name),
          useValue: mockGithubAccountModel,
        },
        {
          provide: getModelToken(GithubCodeChunk.name),
          useValue: mockGithubCodeChunkModel,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<GithubService>(GithubService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAuthUrl', () => {
    it('should generate valid GitHub OAuth authorization URL', () => {
      const { url, state } = service.getAuthUrl('test_state');
      expect(url).toContain('https://github.com/login/oauth/authorize');
      expect(url).toContain('client_id=mock_client_id');
      expect(url).toContain('state=test_state');
      expect(state).toBe('test_state');
    });
  });

  describe('getStatus', () => {
    it('should return connected false when no account exists', async () => {
      mockGithubAccountModel.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null),
          }),
        }),
      });

      const status = await service.getStatus();
      expect(status.connected).toBe(false);
      expect(status.user).toBeNull();
    });

    it('should return connected true and user info when account exists', async () => {
      const mockAccount = {
        username: 'octocat',
        displayName: 'The Octocat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/583231',
        email: 'octocat@github.com',
        scope: 'read:user repo',
        accessToken: 'gho_secret',
      };

      mockGithubAccountModel.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockAccount),
          }),
        }),
      });

      const status = await service.getStatus();
      expect(status.connected).toBe(true);
      expect(status.user?.username).toBe('octocat');
    });
  });

  describe('disconnect', () => {
    it('should clear stored GitHub accounts', async () => {
      const result = await service.disconnect();
      expect(mockGithubAccountModel.deleteMany).toHaveBeenCalled();
      expect(result.message).toContain('disconnected');
    });
  });

  describe('getUserRepositories sorting', () => {
    it('should return most recent repositories first', async () => {
      mockGithubAccountModel.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ accessToken: 'gho_token' }),
          }),
        }),
      });

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([
          {
            name: 'older-repo',
            full_name: 'octocat/older-repo',
            private: false,
            owner: { login: 'octocat' },
            updated_at: '2026-01-10T10:00:00Z',
            pushed_at: '2026-01-10T10:00:00Z',
          },
          {
            name: 'newest-repo',
            full_name: 'octocat/newest-repo',
            private: false,
            owner: { login: 'octocat' },
            updated_at: '2026-11-20T12:00:00Z',
            pushed_at: '2026-11-20T12:00:00Z',
          },
          {
            name: 'middle-repo',
            full_name: 'octocat/middle-repo',
            private: true,
            owner: { login: 'octocat' },
            updated_at: '2026-06-15T08:00:00Z',
            pushed_at: '2026-06-15T08:00:00Z',
          },
        ]),
      } as unknown as Response);

      const repos = await service.getUserRepositories();
      expect(repos.map((r) => r.name)).toEqual([
        'newest-repo',
        'middle-repo',
        'older-repo',
      ]);

      fetchSpy.mockRestore();
    });
  });

  describe('getRepositoryTree filtering', () => {
    it('should include .ts, .js, .md, .json and exclude node_modules, dist, .git, .env, lock files, binaries, and generated files', async () => {
      mockGithubAccountModel.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ accessToken: 'gho_token' }),
          }),
        }),
      });

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          truncated: false,
          tree: [
            { path: 'src', type: 'tree' },
            { path: 'src/main.ts', type: 'blob', size: 120 },
            { path: 'src/index.js', type: 'blob', size: 80 },
            { path: 'README.md', type: 'blob', size: 500 },
            { path: 'package.json', type: 'blob', size: 300 },
            { path: 'package-lock.json', type: 'blob', size: 50000 },
            { path: 'yarn.lock', type: 'blob', size: 40000 },
            { path: '.env', type: 'blob', size: 50 },
            { path: '.env.local', type: 'blob', size: 50 },
            { path: 'node_modules/lodash/index.js', type: 'blob', size: 1000 },
            { path: 'dist/main.js', type: 'blob', size: 2000 },
            { path: '.git/config', type: 'blob', size: 100 },
            { path: 'public/logo.png', type: 'blob', size: 12000 },
            { path: 'src/types.d.ts', type: 'blob', size: 400 },
            { path: 'src/bundle.min.js', type: 'blob', size: 9000 },
          ],
        }),
      } as unknown as Response);

      const res = await service.getRepositoryTree({
        owner: 'octocat',
        repo: 'test-repo',
        branch: 'main',
        recursive: true,
      });

      const returnedPaths = res.tree.map((t) => t.path);
      expect(returnedPaths).toEqual([
        'src',
        'src/main.ts',
        'src/index.js',
        'README.md',
        'package.json',
      ]);

      fetchSpy.mockRestore();
    });
  });
});
