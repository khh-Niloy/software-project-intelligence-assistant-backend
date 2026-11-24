import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import { RetrievalService, RetrievedChunk } from './retrieval.service';

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn(),
}));
jest.mock('@langchain/ollama', () => ({ ChatOllama: jest.fn() }));

describe('RetrievalService answer provider selection', () => {
  const chunks: RetrievedChunk[] = [
    { _id: 'chunk-1', text: 'Relevant context', score: 0.9 },
  ];
  let service: RetrievalService;
  let invoke: jest.Mock;
  let originalNodeEnv: string | undefined;
  let originalGoogleKey: string | undefined;
  let originalGeminiKey: string | undefined;
  let originalPrimaryModel: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalGoogleKey = process.env.GOOGLE_API_KEY;
    originalGeminiKey = process.env.GEMINI_API_KEY;
    originalPrimaryModel = process.env.PRIMARY_MODEL;
    invoke = jest.fn().mockResolvedValue({ content: 'Generated answer' });
    jest.mocked(ChatOllama).mockImplementation(function () {
      return {} as ChatOllama;
    });
    jest.mocked(ChatGoogleGenerativeAI).mockImplementation(function () {
      return {} as ChatGoogleGenerativeAI;
    });
    jest
      .spyOn(ChatPromptTemplate, 'fromMessages')
      .mockReturnValue({
        pipe: jest.fn().mockReturnValue({ invoke }),
      } as never);
    service = new RetrievalService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = originalGoogleKey;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    if (originalPrimaryModel === undefined) delete process.env.PRIMARY_MODEL;
    else process.env.PRIMARY_MODEL = originalPrimaryModel;
  });

  it('uses Ollama in development without Google credentials', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    await expect(
      (service as any).generateAnswer('question', chunks, 'source', false),
    ).resolves.toMatchObject({ answer: 'Generated answer' });

    expect(ChatOllama).toHaveBeenCalledWith({
      model: 'qwen3:0.6b',
      baseUrl: 'http://localhost:11434',
      temperature: 0.2,
    });
    expect(ChatGoogleGenerativeAI).not.toHaveBeenCalled();
  });

  it('uses Gemini in production with the existing key and model configuration', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GOOGLE_API_KEY = 'google-key';
    process.env.PRIMARY_MODEL = 'custom-gemini-model';

    await expect(
      (service as any).generateAnswer('question', chunks, 'source', false),
    ).resolves.toMatchObject({ answer: 'Generated answer' });

    expect(ChatGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: 'google-key',
      model: 'custom-gemini-model',
      temperature: 0.2,
    });
    expect(ChatOllama).not.toHaveBeenCalled();
  });

  it('propagates Ollama failures without trying Gemini', async () => {
    process.env.NODE_ENV = 'development';
    const ollamaError = new Error('connection refused');
    invoke.mockRejectedValueOnce(ollamaError);

    await expect(
      (service as any).generateAnswer('question', chunks, 'source', false),
    ).rejects.toThrow('Ollama answer generation failed: connection refused');
    expect(ChatGoogleGenerativeAI).not.toHaveBeenCalled();
  });
});
