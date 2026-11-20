import { Controller, Get, Param } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get(['chat/qna', 'qna'])
  async getAllQna() {
    return this.chatService.getAllQnas();
  }

  @Get(['chat/qna/:id', 'qna/:id'])
  async getQnaById(@Param('id') id: string) {
    return this.chatService.getQnaById(id);
  }
}
