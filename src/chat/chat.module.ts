import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Qna, QnaSchema } from './schemas/qna.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Qna.name, schema: QnaSchema }])],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
