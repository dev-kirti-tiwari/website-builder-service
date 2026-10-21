class AppError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const pageNotFound = () => new AppError(404, 'PAGE_NOT_FOUND', 'Page not found.');
const sectionNotFound = () => new AppError(404, 'SECTION_NOT_FOUND', 'Section not found.');

module.exports = { AppError, pageNotFound, sectionNotFound };
