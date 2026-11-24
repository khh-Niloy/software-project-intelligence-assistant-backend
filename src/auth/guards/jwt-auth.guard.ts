import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends PassportAuthGuard('jwt') {
  handleRequest<TUser = unknown>(err: unknown, user: unknown): TUser {
    if (err || !user) {
      if (err instanceof Error) {
        throw err;
      }
      throw new UnauthorizedException('Authentication required');
    }
    return user as TUser;
  }
}

// Export AuthGuard alias as requested by specification
export { JwtAuthGuard as AuthGuard };
