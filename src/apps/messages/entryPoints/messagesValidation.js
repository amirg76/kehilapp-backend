import { celebrate, Joi } from 'celebrate';
import { messageConstants } from '../../../config/validationConstants.js';

export const getMessageByIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});

export const getMessagesByCategoriesValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});

export const createMessageValidation = celebrate({
  body: Joi.object().keys({
    categoryId: Joi.string().required(),
    senderId: Joi.string().required(),
    title: Joi.string().min(messageConstants.titleMinLength).max(messageConstants.titleMaxLength).required(),
    text: Joi.string().min(messageConstants.textMinLength).required(),
  }),
});

export const updateMessageValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
  body: Joi.object().keys({
    categoryId: Joi.string().required(),
    senderId: Joi.string().required(),
    title: Joi.string().min(messageConstants.titleMinLength).max(messageConstants.titleMaxLength).required(),
    text: Joi.string().min(messageConstants.textMinLength).required(),
  }),
});

export const deleteMessageValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});
