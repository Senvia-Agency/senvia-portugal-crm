import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { postColumns, commentColumns, reactionColumns } from './feed-actions';
const pageSize = 1000;
async function allComments(organizationId: string, postIds: string[]) {
  const rows: Tables<'workplace_comments'>[] = [];
  for (let offset = 0; offset < postIds.length; offset += 100) {
    for (let from = 0; ; from += pageSize) {
      const page = await supabase.from('workplace_comments').select(commentColumns).eq('organization_id', organizationId).in('post_id', postIds.slice(offset, offset + 100)).order('created_at').order('id').range(from, from + pageSize - 1);
      if (page.error) throw page.error;
      rows.push(...page.data);
      if (page.data.length < pageSize) break;
    }
  }
  return rows;
}
async function allReactions(organizationId: string, postIds: string[]) {
  const rows: Tables<'workplace_reactions'>[] = [];
  for (let offset = 0; offset < postIds.length; offset += 100) {
    for (let from = 0; ; from += pageSize) {
      const page = await supabase.from('workplace_reactions').select(reactionColumns).eq('organization_id', organizationId).in('post_id', postIds.slice(offset, offset + 100)).order('post_id').order('user_id').order('emoji').range(from, from + pageSize - 1);
      if (page.error) throw page.error;
      rows.push(...page.data);
      if (page.data.length < pageSize) break;
    }
  }
  return rows;
}
export async function readOrganizationFeed(organizationId: string) {
  const posts = await supabase.from('workplace_posts').select(postColumns).eq('organization_id', organizationId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
  if (posts.error) throw posts.error;
  const ids = posts.data.map(post => post.id);
  const [comments, reactions] = await Promise.all([allComments(organizationId, ids), allReactions(organizationId, ids)]);
  return { posts: posts.data, comments, reactions };
}
