import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { VideoVisibility } from '@prisma/client';
import { Type } from 'class-transformer';

export class UpdateVideoDto {
  @IsOptional()
  @IsString()
  @Length(1, 140)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  @IsOptional()
  @IsEnum(VideoVisibility)
  visibility?: VideoVisibility;
}

export class ListVideosQuery {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  limit = 24;
}
