import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DocumentModule } from './document/document.module';
import { DatabaseModule } from './database/database.module';
import { ChatModule } from './chat/chat.module';
import { GithubModule } from './github/github.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { TraceModule } from './trace/trace.module';
import { AuthModule } from './auth/auth.module';
import databaseConfig from './config/database.config';
import supabaseConfig from './config/supabase.config';
import jwtConfig from './config/jwt.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, supabaseConfig, jwtConfig],
    }),
    DocumentModule,
    DatabaseModule,
    ChatModule,
    GithubModule,
    IngestionModule,
    RetrievalModule,
    TraceModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
