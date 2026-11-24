import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  it('should return user if authentication succeeded', () => {
    const user = { userId: '123', email: 'test@example.com', role: 'member' };
    const mockContext = {} as ExecutionContext;

    expect(guard.handleRequest(null, user, null, mockContext)).toEqual(user);
  });

  it('should throw UnauthorizedException if no user found', () => {
    const mockContext = {} as ExecutionContext;

    expect(() => guard.handleRequest(null, null, null, mockContext)).toThrow(
      UnauthorizedException,
    );
  });

  it('should throw the original error if an error occurred', () => {
    const mockContext = {} as ExecutionContext;
    const error = new Error('Token expired');

    expect(() => guard.handleRequest(error, null, null, mockContext)).toThrow(
      error,
    );
  });
});
