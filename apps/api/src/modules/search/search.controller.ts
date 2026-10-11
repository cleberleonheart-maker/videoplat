import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { Public } from '../../common/decorators/public.decorator';
import { listQuery } from '../../common/utils/list-query';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Get()
  videos(@Query('q') q = '', @Query('limit') limit = '24') {
    const { limit: safeLimit } = listQuery(limit, undefined, 24);
    return this.search.search(q, safeLimit);
  }
}
