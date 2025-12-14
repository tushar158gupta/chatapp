const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const { toJSON, paginate } = require('./plugins');
const { roles } = require('../config/roles');

const advisorSchema = mongoose.Schema(
  {
    sId: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    fName: { type: String, required: true },
    lName: { type: String, default: null },
    dp: { type: String, default: null },
    accuracy: { type: Number, default: 0 },
    mobile: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    rType: {
      type: String,
      enum: ['SEBI_REGISTERED_ADVISOR', 'SEBI_RESEARCH_ANALYST', 'SOCIAL_TRADERS'],
      default: 'SOCIAL_TRADERS',
    },
    rNo: { type: String, required: true, unique: true },
    role: {
      type: String,
      enum: ['ADVISOR', 'USER', 'TRADER', 'ADMIN'],
      default: 'ADVISOR',
    },
    isEmailVerified: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    experience: { type: Number, default: 0 },
    PAN: { type: String, sparse: true, unique: true },
    GST: { type: String, sparse: true, unique: true },
    addressLine1: { type: String, default: '' },
    addressLine2: { type: String, default: '' },
    city: { type: String, default: '' },
    pincode: { type: String, default: '' },
    state: { type: String, default: '' },
    about: { type: String, default: '' },
    regulatoryDisclosure: [
      {
        complainDate: { type: Date, required: true },
        status: { type: String, enum: ['Resolved', 'Pending'], required: true },
        complainResolvedDate: { type: Date },
      },
    ],
    files: {
      type: Map,
      of: { type: mongoose.Schema.Types.ObjectId, ref: 'File', default: null },
      default: {},
    },
    verificationStatus: {
      type: String,
      enum: ['SUBMITTED', 'VERIFIED', 'REJECTED'],
      required: false,
    },
    active: {
      type: Boolean,
      default: false,
    },
    otp: String,
    otpExpires: Date,
    otpRequestCount: {
      type: Number,
      default: 0,
    },
    lastOtpRequestDate: Date,
    isMobileVerified: {
      type: Boolean,
      default: false,
    },
    isBlocked: {
      type: Boolean,
      default: false,
      sparse: true,
    },
    blockedBy: {
      type: mongoose.Types.ObjectId,
      ref: 'Associates',
      default: null,
      sparse: true,
    },
    blockedDate: {
      type: Date,
      sparse: true,
    },
    blockedNote: {
      type: String,
      default: null,
      sparse: true,
    },
    reviewerNote: { type: String, default: '' },
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    lastApprovedRecord: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    lastRejectedRecord: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }, versionKey: false }
);

advisorSchema.plugin(toJSON);
advisorSchema.plugin(paginate);

advisorSchema.statics.isEmailTaken = async function (email, excludeUserId) {
  const advisor = await this.findOne({ email, _id: { $ne: excludeUserId } });
  return !!advisor;
};

const Advisor = mongoose.model('Advisor', advisorSchema, 'Advisor');

module.exports = Advisor;
