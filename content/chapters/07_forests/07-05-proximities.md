---
title: "Chapter 07.05: Proximities"
weight: 7005
quizdown: true
---

The term *proximity* refers to the "closeness" between pairs of cases. Proximities are calculated for each pair of observations and can be derived directly from random forests.

<!--more-->

### Lecture video

{{< video id="TYqXaZ5HCtI" >}}

### Lecture slides

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/slides-pdf/slides-forests-proximities.pdf" >}}

### Code demo

**Random Forests**

You can run the code snippets in the demos on your local machine. The corresponding Rmd version of this demo can be found [here](https://github.com/compstat-lmu/lecture_i2ml/blob/master/code-demos/code_demo_randforests.Rmd). If you want to render the Rmd files to PDF, you need the accompanying [style files](https://github.com/compstat-lmu/lecture_i2ml/tree/master/style). 

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/code-demos-pdf/code_demo_randforests.pdf" >}}

### Quiz

{{< quizdown >}}

---
shuffle_questions: false
---

## Which statements are true? 

- [x] To compute permutation variable importance for feature $j$, we permute the feature and see how the performance changes (in OOB observations).
- [ ] The random forest is a bad out-of-the box model and requires tuning of hyperparameters.
- [x] Random forests and trees can be used for high-dimensional data.
- [ ] Proximities are used in replacing missing data, but not in locating outliers.

{{< /quizdown >}}