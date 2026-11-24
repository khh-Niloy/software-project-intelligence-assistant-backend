import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Request } from 'express';
import { jwtConfig } from '../../config/jwt.config';
import type { JwtConfig } from '../../config/jwt.config';
import { User, UserRecord } from '../schemas/user.schema';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

const cookieExtractor = (req: Request): string | null => {
  if (req && req.cookies) {
    const cookies = req.cookies as Record<string, unknown>;
    const token = cookies['access_token'];
    if (typeof token === 'string') {
      return token;
    }
  }
  return null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(jwtConfig.KEY)
    private readonly config: JwtConfig,
    @InjectModel(User.name)
    private readonly userModel: Model<UserRecord>,
  ) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      secretOrKey: config.accessSecret,
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const user = await this.userModel.findById(payload.sub).exec();
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return {
      _id: user._id,
      userId: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };
  }
}
