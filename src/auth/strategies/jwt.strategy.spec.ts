import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let mockUserModel: any;

  const mockConfig = {
    accessSecret: 'test-secret',
    accessExpiresIn: '15m',
    refreshSecret: 'test-refresh-secret',
    refreshExpiresIn: '7d',
  };

  beforeEach(() => {
    mockUserModel = {
      findById: jest.fn(),
    };
    strategy = new JwtStrategy(mockConfig, mockUserModel);
  });

  it('should throw UnauthorizedException if payload is missing or invalid', async () => {
    await expect(strategy.validate({} as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException if user no longer exists in DB', async () => {
    mockUserModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      strategy.validate({
        sub: new Types.ObjectId().toString(),
        email: 'test@example.com',
        role: 'member',
        organizationId: new Types.ObjectId().toString(),
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should return sanitized user details if payload and user are valid', async () => {
    const userId = new Types.ObjectId();
    const orgId = new Types.ObjectId();

    mockUserModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: userId,
        name: 'Valid User',
        email: 'valid@example.com',
        role: 'member',
        organizationId: orgId,
      }),
    });

    const result = await strategy.validate({
      sub: userId.toString(),
      email: 'valid@example.com',
      role: 'member',
      organizationId: orgId.toString(),
    });

    expect(result).toEqual({
      _id: userId,
      userId: userId.toString(),
      name: 'Valid User',
      email: 'valid@example.com',
      role: 'member',
      organizationId: orgId,
    });
  });
});
