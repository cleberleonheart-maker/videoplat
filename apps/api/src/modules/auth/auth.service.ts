import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { JwtPayload } from './strategies/jwt.strategy';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface AuthResult extends AuthTokens {
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    avatarKey: string | null;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { username: dto.username }],
      },
    });
    if (existing) {
      throw new ConflictException('Email or username already in use');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        displayName: dto.displayName,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarKey: true,
      },
    });

    return { user, ...(await this.issueTokens(user)) };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Compara mesmo sem usuário para não vazar quais emails existem (timing).
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const valid = await argon2.verify(hash, dto.password).catch(() => false);

    if (!user || !valid || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarKey: user.avatarKey,
      },
      ...(await this.issueTokens(user)),
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload & { type?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, username: true },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');

    return this.issueTokens(user);
  }

  private async issueTokens(
    user: { id: string; username: string },
  ): Promise<AuthTokens> {
    const base: JwtPayload = { sub: user.id, username: user.username };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(base),
      this.jwt.signAsync({ ...base, type: 'refresh' }, { expiresIn: '30d' }),
    ]);
    return { accessToken, refreshToken, expiresIn: '15m' };
  }
}

// Hash descartável para igualizar o tempo de resposta no login.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$J8Xk3wYqQ2n5rTbKvA1sZ0eLpQxYh9J2mB7uV4nC6dW8';
