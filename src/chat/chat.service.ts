import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Qna, QnaRecord } from './schemas/qna.schema';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Qna.name)
    private readonly qnaModel: Model<QnaRecord>,
  ) {}

  async getAllQnas() {
    return this.qnaModel.find().sort({ createdAt: -1 }).lean().exec();
  }

  async getQnaById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid Q&A ID format: ${id}`);
    }
    const qna = await this.qnaModel.findById(id).lean().exec();
    if (!qna) throw new NotFoundException(`Q&A with ID "${id}" not found`);
    return qna;
  }
}
