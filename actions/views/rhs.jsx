// Copyright (c) 2017 Mattermost, Inc. All Rights Reserved.
// See License.txt for license information.

import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';
import {getCurrentTeamId} from 'mattermost-redux/selectors/entities/teams';
import {makeGetMessageInHistoryItem, makeGetCommentCountForPost} from 'mattermost-redux/selectors/entities/posts';
import {getCustomEmojisByName} from 'mattermost-redux/selectors/entities/emojis';

import {
  addReaction,
  removeReaction,
  addMessageIntoHistory,
  moveHistoryIndexBack,
  moveHistoryIndexForward
} from 'mattermost-redux/actions/posts';

import {Posts} from 'mattermost-redux/constants';

import * as PostActions from 'actions/post_actions.jsx';
import * as GlobalActions from 'actions/global_actions.jsx';
import * as ChannelActions from 'actions/channel_actions.jsx';
import {setGlobalItem, actionOnGlobalItemsWithPrefix} from 'actions/storage';
import {EmojiMap} from 'stores/emoji_store.jsx';

import {makeGetCurrentUsersLatestPost, makeGetCommentDraft} from 'selectors/rhs';

import * as Utils from 'utils/utils.jsx';

import {REACTION_PATTERN} from 'components/create_post.jsx';

export function clearCommentDraftUploads() {
    return actionOnGlobalItemsWithPrefix('comment_draft_', (key, value) => {
        if (value) {
            return {...value, uploadsInProgress: []};
        }
        return value;
    });
}

export function updateCommentDraft(rootId, draft) {
    return setGlobalItem(`comment_draft_${rootId}`, draft);
}

export function makeOnMoveHistoryIndex(rootId, direction) {
    const getMessageInHistory = makeGetMessageInHistoryItem(Posts.MESSAGE_TYPES.COMMENT);
    const getCommentDraft = makeGetCommentDraft(rootId);

    return () => (dispatch, getState) => {
        const draft = getCommentDraft(getState());

        if (draft.message !== '' && draft.message !== getMessageInHistory(getState())) {
            return;
        }

        if (direction === -1) {
            dispatch(moveHistoryIndexBack(Posts.MESSAGE_TYPES.COMMENT));
        } else if (direction === 1) {
            dispatch(moveHistoryIndexForward(Posts.MESSAGE_TYPES.COMMENT));
        }

        const nextMessageInHistory = getMessageInHistory(getState());

        dispatch(updateCommentDraft(rootId, {...draft, message: nextMessageInHistory}));
    };
}

export function submitPost(channelId, rootId, draft) {
    return (dispatch, getState) => {
        const state = getState();

        const userId = getCurrentUserId(state);

        const time = Utils.getTimestamp();

        const post = {
            file_ids: [],
            message: draft.message,
            channel_id: channelId,
            root_id: rootId,
            parent_id: rootId,
            pending_post_id: `${userId}:${time}`,
            user_id: userId,
            create_at: time
        };

        GlobalActions.emitUserCommentedEvent(post);

        PostActions.createPost(post, draft.fileInfos);
    };
}

export function submitReaction(postId, action, emojiName) {
    return (dispatch) => {
        if (action === '+') {
            dispatch(addReaction(postId, emojiName));
        } else if (action === '-') {
            dispatch(removeReaction(postId, emojiName));
        }
    };
}

export function submitCommand(channelId, rootId, draft) {
    return (dispatch, getState) => {
        const state = getState();

        const teamId = getCurrentTeamId(state);

        const args = {
            channel_id: channelId,
            team_id: teamId,
            root_id: rootId,
            parent_id: rootId
        };

        const {message} = draft;

        return new Promise((resolve, reject) => {
            ChannelActions.executeCommand(message, args, resolve, (err) => {
                if (err.sendMessage) {
                    dispatch(submitPost(channelId, rootId, draft));
                } else {
                    reject(err);
                }
            });
        });
    };
}

export function makeOnSubmit(channelId, rootId, latestPostId) {
    const getCommentDraft = makeGetCommentDraft(rootId);

    return () => async (dispatch, getState) => {
        const draft = getCommentDraft(getState());
        const {message} = draft;

        dispatch(addMessageIntoHistory(message));

        dispatch(updateCommentDraft(rootId, null));

        const isReaction = REACTION_PATTERN.exec(message);

        const emojis = getCustomEmojisByName(getState());
        const emojiMap = new EmojiMap(emojis);

        if (isReaction && emojiMap.has(isReaction[2])) {
            dispatch(submitReaction(latestPostId, isReaction[1], isReaction[2]));
        } else if (message.indexOf('/') === 0) {
            await dispatch(submitCommand(channelId, rootId, draft));
        } else {
            dispatch(submitPost(channelId, rootId, draft));
        }
    };
}

export function makeOnEditLatestPost(channelId, rootId) {
    const getCurrentUsersLatestPost = makeGetCurrentUsersLatestPost(channelId, rootId);
    const getCommentCount = makeGetCommentCountForPost();

    return () => (dispatch, getState) => {
        const state = getState();

        const lastPost = getCurrentUsersLatestPost(state);

        if (!lastPost) {
            return;
        }

        dispatch(PostActions.setEditingPost(
            lastPost.id,
            getCommentCount(state, {post: lastPost}),
            '#reply_textbox',
            Utils.localizeMessage('create_comment.commentTitle', 'Comment')
        ));
    };
}