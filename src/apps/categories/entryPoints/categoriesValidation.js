import { celebrate, Joi } from 'celebrate';
import { categoryConstants } from '../../../config/validationConstants.js';

// export const getCategoriesValidation = celebrate({});

export const getCategoryByIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});

export const createCategoryValidation = celebrate({
  body: Joi.object().keys({
    title: Joi.string().min(categoryConstants.titleMinLength).max(categoryConstants.titleMaxLength).required(),
    managedBy: Joi.string().optional(), //change optional to required when implementing role-base auth
    icon: Joi.string().required(),
    categoryColor: Joi.string().required(),
    file: Joi.optional(),
  }),
});

export const updateCategoryValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
  body: Joi.object().keys({
    title: Joi.string().min(categoryConstants.titleMinLength).max(categoryConstants.titleMaxLength).optional(),
    managedBy: Joi.string().optional(),
    icon: Joi.string().optional(),
    categoryColor: Joi.string().optional(),
    file: Joi.optional(),
  }),
});

export const deleteCategoryValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
});
