import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';

describe('IngestionController', () => {
  let controller: IngestionController;

  const mockIngestionService = {
    ingestDocument: jest.fn().mockResolvedValue({
      message: 'Document ingested',
      stats: { totalChunks: 2 },
    }),
    ingestRepository: jest.fn().mockResolvedValue({
      repoName: 'my-repo',
      totalFiles: 3,
      totalChunks: 8,
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IngestionController],
      providers: [
        {
          provide: IngestionService,
          useValue: mockIngestionService,
        },
      ],
    }).compile();

    controller = module.get<IngestionController>(IngestionController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('ingestDocument (POST /ingest/doc)', () => {
    it('should throw BadRequestException when file is missing', async () => {
      await expect(
        controller.ingestDocument(undefined as unknown as Express.Multer.File),
      ).rejects.toThrow(BadRequestException);
    });

    it('should delegate file upload to IngestionService.ingestDocument', async () => {
      const mockFile = {
        originalname: 'test.txt',
        buffer: Buffer.from('hello'),
      } as Express.Multer.File;

      const res = await controller.ingestDocument(mockFile);
      expect(mockIngestionService.ingestDocument).toHaveBeenCalledWith(
        mockFile,
      );
      expect(res.stats.totalChunks).toBe(2);
    });
  });

  describe('ingestRepository (POST /ingest/repo)', () => {
    it('should delegate repo ingestion to IngestionService.ingestRepository', async () => {
      const res = await controller.ingestRepository({ repoName: 'my-repo' });
      expect(mockIngestionService.ingestRepository).toHaveBeenCalledWith({
        repoName: 'my-repo',
      });
      expect(res.repoName).toBe('my-repo');
    });
  });
});
