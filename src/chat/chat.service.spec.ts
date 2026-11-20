import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ChatService } from './chat.service';
import { Qna } from './schemas/qna.schema';

describe('ChatService', () => {
  let service: ChatService;
  const qna = { _id: new Types.ObjectId(), question: 'test question' };
  const mockQnaModel = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue([qna]) }),
      }),
    }),
    findById: jest.fn().mockReturnValue({
      lean: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(qna) }),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getModelToken(Qna.name), useValue: mockQnaModel },
      ],
    }).compile();
    service = module.get<ChatService>(ChatService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns Q&A history', async () => {
    await expect(service.getAllQnas()).resolves.toEqual([qna]);
  });

  it('returns a Q&A by id', async () => {
    await expect(service.getQnaById(qna._id.toString())).resolves.toEqual(qna);
  });
});
