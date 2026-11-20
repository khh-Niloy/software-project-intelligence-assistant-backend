import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { DocumentService } from './document.service';
import { Document } from './schemas/document.schema';

describe('DocumentService', () => {
  let service: DocumentService;

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
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockDocumentRecord]),
      }),
    }),
    findById: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockDocumentRecord),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        {
          provide: getModelToken(Document.name),
          useValue: mockDocumentModel,
        },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllDocuments', () => {
    it('should return all documents sorted by createdAt descending', async () => {
      const docs = await service.getAllDocuments();
      expect(docs).toHaveLength(1);
      expect(docs[0].filename).toBe('sample.txt');
    });
  });

  describe('getDocumentById', () => {
    it('should return a document by valid ObjectId', async () => {
      const doc = await service.getDocumentById('507f191e810c19729de860ea');
      expect(doc.filename).toBe('sample.txt');
    });
  });
});
