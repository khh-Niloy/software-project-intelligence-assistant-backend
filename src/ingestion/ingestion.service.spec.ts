import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { Document as LangchainDocument } from '@langchain/core/documents';
import { IngestionService } from './ingestion.service';
import { Document } from '../document/schemas/document.schema';
import { DocumentChunk } from '../document/schemas/document-chunk.schema';
import { GithubAccount } from '../github/schemas/github-account.schema';
import { GithubCodeChunk } from '../github/schemas/github-code-chunk.schema';
import { SupabaseService } from '../supabase/supabase.service';

describe('IngestionService', () => {
  let service: IngestionService;

  const mockDocumentRecord = {
    _id: new Types.ObjectId('507f191e810c19729de860ea'),
    filename: 'sample.txt',
    fileUrl:
      'https://mock.supabase.co/storage/v1/object/public/documents/sample.txt',
    originalText: 'Hello world. This is a test document.',
    status: 'completed',
    totalChunks: 1,
  };

  const mockDocumentModel = {
    create: jest.fn().mockResolvedValue(mockDocumentRecord),
  };

  const mockDocumentChunkModel = {
    insertMany: jest.fn().mockResolvedValue([]),
  };

  const mockGithubAccountModel = {
    findOne: jest.fn(),
  };

  const mockGithubCodeChunkModel = {
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    insertMany: jest.fn().mockImplementation((docs: unknown[]) => docs),
  };

  const mockSupabaseService = {
    uploadFile: jest.fn().mockResolvedValue({
      fileUrl:
        'https://mock.supabase.co/storage/v1/object/public/documents/sample.txt',
      path: 'sample.txt',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionService,
        {
          provide: getModelToken(Document.name),
          useValue: mockDocumentModel,
        },
        {
          provide: getModelToken(DocumentChunk.name),
          useValue: mockDocumentChunkModel,
        },
        {
          provide: getModelToken(GithubAccount.name),
          useValue: mockGithubAccountModel,
        },
        {
          provide: getModelToken(GithubCodeChunk.name),
          useValue: mockGithubCodeChunkModel,
        },
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
      ],
    }).compile();

    service = module.get<IngestionService>(IngestionService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createChunks', () => {
    it('should split LangChain documents into chunks using RecursiveCharacterTextSplitter', async () => {
      const docs = [
        new LangchainDocument({
          pageContent: 'Sentence one. Sentence two. Sentence three.',
          metadata: { source: 'sample.txt' },
        }),
      ];

      const chunks = await service.createChunks(docs, 20, 5);
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('ingestDocument (POST /ingest/doc)', () => {
    it('should upload to Supabase, chunk, generate embeddings, and save to DB', async () => {
      const mockFile = {
        originalname: 'sample.txt',
        mimetype: 'text/plain',
        size: 38,
        buffer: Buffer.from('Hello world. This is a test document.'),
      } as Express.Multer.File;

      const mockVector = [0.1, 0.2, 0.3];
      const embeddingsSpy = jest
        .spyOn(service, 'generateEmbeddings')
        .mockResolvedValue([mockVector]);

      const result = await service.ingestDocument(mockFile);

      expect(mockSupabaseService.uploadFile).toHaveBeenCalledWith(mockFile);
      expect(embeddingsSpy).toHaveBeenCalled();
      expect(mockDocumentModel.create).toHaveBeenCalled();
      expect(mockDocumentChunkModel.insertMany).toHaveBeenCalled();
      expect(result.stats.totalChunks).toBeGreaterThan(0);
    });
  });

  describe('ingestRepository (POST /ingest/repo)', () => {
    it('should resolve owner from DB, fetch main branch tree & contents, chunk code, embed, and store in MongoDB', async () => {
      mockGithubAccountModel.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              username: 'khh-Niloy',
              accessToken: 'gho_token',
            }),
          }),
        }),
      });

      const sampleCode = [
        'export class AuthService {',
        '  async login() {',
        '    return { ok: true };',
        '  }',
        '}',
      ].join('\n');

      jest
        .spyOn(service, 'generateEmbeddings')
        .mockResolvedValue([[0.12, 0.45, 0.67]]);

      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((input: string | URL | Request) => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;

          if (url.includes('/git/trees/')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () =>
                Promise.resolve({
                  tree: [
                    { path: 'src/auth/auth.service.ts', type: 'blob' },
                    { path: 'package-lock.json', type: 'blob' },
                  ],
                }),
            } as unknown as Response);
          }

          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                type: 'file',
                encoding: 'base64',
                content: Buffer.from(sampleCode, 'utf-8').toString('base64'),
              }),
          } as unknown as Response);
        });

      const result = await service.ingestRepository({
        repoName: 'my-test-repo',
      });

      expect(result.repoName).toBe('my-test-repo');
      expect(result.owner).toBe('khh-Niloy');
      expect(result.branch).toBe('main');
      expect(result.totalFiles).toBe(1);
      expect(result.totalChunks).toBe(1);
      expect(result.chunks[0]).toEqual({
        repoName: 'my-test-repo',
        filePath: 'src/auth/auth.service.ts',
        language: 'typescript',
        className: 'AuthService',
        functionName: 'login',
        startLine: 1,
        endLine: 5,
        content: sampleCode,
        embedding: [0.12, 0.45, 0.67],
      });

      fetchSpy.mockRestore();
    });
  });
});
