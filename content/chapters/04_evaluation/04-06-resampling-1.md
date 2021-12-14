---
title: "Chapter 04.06: Resampling 1"
weight: 4006
quizdown: true
---

Different resampling techniques help to assess the performance of a learner while avoiding potential quirks resulting from a single train-test split. We will introduce cross-validation (with and without stratification), bootstrap and subsampling.

<!--more-->

### Lecture video

{{< video id="YWmC0C_NBLk" >}}

### Lecture slides

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/blob/master/slides-pdf/slides-evaluation-resampling-1.pdf" >}}

### Code demo

**Resampling**

You can run the code snippets in the demos on your local machine. The corresponding Rmd version of this demo can be found [here](https://github.com/compstat-lmu/lecture_i2ml/blob/master/code-demos/code_demo_resampling.Rmd). If you want to render the Rmd files to PDF, you need the accompanying [style files](https://github.com/compstat-lmu/lecture_i2ml/tree/master/style). 

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/code-demos-pdf/code_demo_resampling.pdf" >}}

### Quiz

{{< quizdown >}}

---
shuffle_questions: false
---

## Which statements are true? 

- [x] Cross-validation, bootstrap, and subsampling are resampling techniques.
- [x] Estimating the expected generalization error is a goal of resampling.
- [ ] In bootstrap, each observation serves as a test point exactly once.
- [x] In resampling, the data set is split repeatedly into training and tests sets.
- [ ] Resampling strategies are unbiased.

{{< /quizdown >}}
