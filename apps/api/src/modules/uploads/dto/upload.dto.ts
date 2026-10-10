import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum Visibility {
  PUBLIC = 'PUBLIC',
  UNLISTED = 'UNLISTED',
  PRIVATE = 'PRIVATE',
}

export class StartUploadDto {
  @IsString()
  @Length(1, 200)
  fileName: string;

  @IsString()
  contentType: string;

  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024 * 1024)
  sizeBytes: number;

  @IsOptional()
  @IsString()
  @Length(1, 140)
  title?: string;
}

export class CompletedPartDto {
  @IsInt()
  @Min(1)
  partNumber: number;

  @IsString()
  etag: string;
}

export class CompleteUploadDto {
  @IsString()
  videoId: string;

  // Null em upload único (arquivos pequenos enviam tudo num PUT só).
  @IsOptional()
  @IsString()
  uploadId?: string;

  @IsArray()
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts: CompletedPartDto[];

  @IsOptional()
  @IsString()
  @Length(1, 140)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  /** Corte do vídeo (segundos), aplicado no worker antes de transcodificar. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  trimStartSec?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  trimEndSec?: number;

  /** Frame (segundos) escolhido para virar a capa do vídeo. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  thumbnailTimeSec?: number;
}
